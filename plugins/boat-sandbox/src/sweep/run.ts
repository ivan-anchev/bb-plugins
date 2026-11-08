// The minutely sweep: read bb and boat, let planSweep decide, apply what it decided.
import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";
import type { BoatAccess } from "../boat/access.ts";
import type { BoatClient } from "../boat/client.ts";
import type { Sandbox, SandboxId } from "../boat/sandbox.ts";
import type { IdleClock } from "../idle-clock.ts";
import { LEASE_TTL_SECONDS, PROVIDER_ID } from "../machine-provider.ts";
import { ownerLabels, parseResource } from "../ownership.ts";
import { planSweep, type HostView, type SweepAction } from "./plan.ts";

type Sdk = BbPluginApi["sdk"];
type ThreadStatus = NonNullable<NonNullable<Parameters<Sdk["threads"]["count"]>[0]>["status"]>;
type Host = Awaited<ReturnType<Sdk["hosts"]["list"]>>[number];
/** The part of a bb host the sweep reads. */
type HostFacts = Pick<Host, "id" | "machineProviderId"> & { lifecycle: Pick<Host["lifecycle"], "phase"> };

/** What the sweep asks of bb; the plugin API is one. */
interface SweepBb {
  sdk: {
    hosts: {
      list(args: { includeCreating: boolean; signal: AbortSignal }): Promise<HostFacts[]>;
      get(args: { hostId: string; signal: AbortSignal }): Promise<HostFacts>;
      experimental_suspend(args: { hostId: string }): Promise<unknown>;
    };
    threads: { count(args: { hostId: string; status: ThreadStatus; signal: AbortSignal }): Promise<{ total: number }> };
  };
  experimental_machines: { getResource(hostId: string): Promise<JsonValue | null> };
  log: Pick<BbPluginApi["log"], "info" | "warn">;
}

interface SweepDeps {
  bb: SweepBb;
  access: BoatAccess;
  idle: IdleClock;
  ownerId: string;
}

/** One sweep's boat session and its view of boat, kept to decide again just before a suspend. */
interface SweepRun extends SweepDeps {
  client: BoatClient;
  signal: AbortSignal;
  plan(hosts: readonly HostView[]): SweepAction[];
}

/** A thread in any of these is working, however quiet: a 20-minute silent tool call stays `active`. */
const BUSY_STATUSES: readonly ThreadStatus[] = ["pending", "starting", "active", "stopping"];
/** Ends a sweep before the next one is due. */
const SWEEP_PATIENCE_MS = 50_000;

/**
 * One sweep at a time: a sweep that finds the last one still running skips this minute. A sweep
 * that runs out of time (50 s unless `signal` says otherwise) stops applying and rejects.
 */
export function createSweep(deps: SweepDeps): (signal?: AbortSignal) => Promise<void> {
  let running = false;
  return async (signal = AbortSignal.timeout(SWEEP_PATIENCE_MS)) => {
    if (running) return;
    running = true;
    try {
      await sweep(deps, signal);
    } finally {
      running = false;
    }
  };
}

async function sweep(deps: SweepDeps, signal: AbortSignal): Promise<void> {
  const hosts = await observeHosts(deps, signal);
  // No boat call while this server has no boat machine.
  if (hosts.length === 0) return;
  const { client, settings } = await deps.access.session(signal);
  const sandboxes = await listSandboxes(client, deps.ownerId, signal);
  const plan = (views: readonly HostView[]) => planSweep({ hosts: views, sandboxes }, { now: Date.now(), idleMs: settings.idleMs });
  await applyActions({ ...deps, client, signal, plan }, plan(hosts));
}

async function observeHosts(deps: SweepDeps, signal: AbortSignal): Promise<HostView[]> {
  const hosts = (await deps.bb.sdk.hosts.list({ includeCreating: true, signal })).filter(
    (host) => host.machineProviderId === PROVIDER_ID,
  );
  return (await Promise.all(hosts.map((host) => observeHost(deps, host, signal)))).filter((view) => view !== null);
}

/** null for a create that has not checkpointed yet: it has no sandbox to look after. */
async function observeHost({ bb, idle }: SweepDeps, host: HostFacts, signal: AbortSignal): Promise<HostView | null> {
  const resource = await bb.experimental_machines.getResource(host.id);
  if (resource === null) return null;
  const phase = host.lifecycle.phase;
  return {
    hostId: host.id,
    phase,
    sandboxId: parseResource(resource).sandboxId,
    busy: phase === "active" && (await isBusy(bb, host.id, signal)),
    lastActiveAt: await idle.read(host.id),
  };
}

/** Counted, never paged through `threads.list`, which would miscount past its limit (SDK `ThreadCountArgs`). */
async function isBusy(bb: SweepBb, hostId: string, signal: AbortSignal): Promise<boolean> {
  const counts = await Promise.all(BUSY_STATUSES.map((status) => bb.sdk.threads.count({ hostId, status, signal })));
  return counts.some(({ total }) => total > 0);
}

async function listSandboxes(client: BoatClient, ownerId: string, signal: AbortSignal): Promise<Map<SandboxId, Sandbox>> {
  const sandboxes = await client.list(ownerLabels(ownerId), signal);
  return new Map(sandboxes.map((sandbox) => [sandbox.id, sandbox]));
}

/**
 * One action failing never stops the rest; the next sweep plans again from scratch. Running out of
 * time stops them all, and the sweep rejects even when the action it ran out during succeeded.
 */
async function applyActions(run: SweepRun, actions: readonly SweepAction[]): Promise<void> {
  for (const action of actions) {
    run.signal.throwIfAborted();
    try {
      await apply(run, action);
    } catch (error) {
      run.signal.throwIfAborted();
      // Core refuses while a launch, provisioning or checkout setup is live on the machine.
      if (hasCode(error, "machine_busy")) continue;
      run.bb.log.warn(`boat sweep: ${action.kind} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  run.signal.throwIfAborted();
}

async function apply(run: SweepRun, action: SweepAction): Promise<void> {
  const { bb, idle, client, signal } = run;
  switch (action.kind) {
    case "mark-active":
      return idle.touch(action.hostId);
    case "suspend-idle":
      if (!(await isStillIdle(run, action.hostId))) return;
      // The re-check's reads can outlast the time limit, and bb's suspend takes no signal: this is the last chance to stop.
      signal.throwIfAborted();
      bb.log.info(`Suspending idle boat machine ${action.hostId}.`);
      await bb.sdk.hosts.experimental_suspend({ hostId: action.hostId });
      return;
    case "renew-lease":
      bb.log.info(`Renewing the auto-stop of boat sandbox ${action.sandboxId} to ${LEASE_TTL_SECONDS} s from now.`);
      return client.setTtl(action.sandboxId, LEASE_TTL_SECONDS, signal);
    default:
      action satisfies never;
  }
}

/**
 * Suspending interrupts the machine's turns, and the plan was made from a look taken before the boat
 * calls and earlier actions. A follow-up or terminal input since then must win, so look again and decide again.
 */
async function isStillIdle(run: SweepRun, hostId: string): Promise<boolean> {
  const view = await observeHost(run, await run.bb.sdk.hosts.get({ hostId, signal: run.signal }), run.signal);
  return view !== null && run.plan([view]).some((action) => action.kind === "suspend-idle");
}

/** bb's SDK errors carry the API's error code. */
const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

// The minutely sweep: look at bb and boat, let planSweep decide, apply what it decided.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BoatAccess } from "../boat/access.ts";
import type { BoatClient } from "../boat/client.ts";
import type { IdleClock } from "../idle-clock.ts";
import { describeProblems } from "../problem.ts";
import { LEASE_TTL_SECONDS } from "../sandbox-power.ts";
import { observe, observeHost, type HostFacts, type ObserveBb } from "./observe.ts";
import { planSweep, type SweepAction, type SweepInput, type SweepPolicy } from "./plan.ts";

/** What the sweep asks of bb; the plugin API is one. */
interface SweepBb extends ObserveBb {
  sdk: ObserveBb["sdk"] & {
    hosts: ObserveBb["sdk"]["hosts"] & {
      get(args: { hostId: string; signal: AbortSignal }): Promise<HostFacts>;
      experimental_suspend(args: { hostId: string }): Promise<unknown>;
      experimental_reconcile(args: { hostId: string }): Promise<unknown>;
    };
  };
  log: Pick<BbPluginApi["log"], "info" | "warn">;
}

interface SweepDeps {
  bb: SweepBb;
  access: BoatAccess;
  idle: IdleClock;
  ownerId: string;
}

/** One sweep's boat session and its look at bb and boat, kept to decide again just before a suspend. */
interface SweepRun extends SweepDeps {
  client: BoatClient;
  signal: AbortSignal;
  input: SweepInput;
  policy(): SweepPolicy;
}

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
  const configuration = await deps.access.configuration(signal);
  // No key means nothing on boat to look after; any other problem leaves machines unwatched, so it fails loudly.
  if (configuration.status === "setup-required") return;
  if (configuration.status !== "available") throw new Error(describeProblems(configuration.problems));
  const input = await observe(deps, configuration.client, signal);
  const policy = (): SweepPolicy => ({ now: Date.now(), idleMs: configuration.settings.idleMs });
  await applyActions({ ...deps, client: configuration.client, signal, input, policy }, planSweep(input, policy()));
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
    case "record-stopped":
      // Core suspends in the background. Within about a minute of a boat-side stop bb still holds the
      // daemon's session, so core cancels after 30 s and logs it; the next sweep asks again.
      bb.log.info(`${action.why}, but bb has machine ${action.hostId} active; recording it as suspended.`);
      await bb.sdk.hosts.experimental_suspend({ hostId: action.hostId });
      return;
    case "stop-again":
      bb.log.info(`boat machine ${action.hostId} is suspended in bb, but its sandbox is running; stopping it again.`);
      await bb.sdk.hosts.experimental_reconcile({ hostId: action.hostId });
      return;
    case "stop-orphan":
      bb.log.warn(`Stopping boat sandbox ${action.sandboxId}: no bb machine uses it. Its disk is kept; \`boat delete ${action.sandboxId}\` deletes it.`);
      return client.stop(action.sandboxId, signal);
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
  if (view === null) return false;
  const hosts = run.input.hosts.map((host) => (host.hostId === hostId ? view : host));
  return planSweep({ ...run.input, hosts }, run.policy()).some((action) => action.kind === "suspend-idle" && action.hostId === hostId);
}

/** bb's SDK errors carry the API's error code. */
const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

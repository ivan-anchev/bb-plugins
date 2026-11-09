// What the sweep and `bb boat sandboxes` look at: bb's boat machines, then this server's sandboxes on boat.
import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";
import type { BoatClient } from "../boat/client.ts";
import type { Sandbox, SandboxId } from "../boat/sandbox.ts";
import type { IdleClock } from "../idle-clock.ts";
import { PROVIDER_ID } from "../machine-provider.ts";
import { ownerLabels, parseResource } from "../ownership.ts";
import type { HostView, SweepInput } from "./plan.ts";

type Sdk = BbPluginApi["sdk"];
type ThreadStatus = NonNullable<NonNullable<Parameters<Sdk["threads"]["count"]>[0]>["status"]>;
type Host = Awaited<ReturnType<Sdk["hosts"]["list"]>>[number];
/** The part of a bb host the sweep reads. */
export type HostFacts = Pick<Host, "id" | "machineProviderId"> & { lifecycle: Pick<Host["lifecycle"], "phase"> };

/** What observing asks of bb; the plugin API is one. */
export interface ObserveBb {
  sdk: {
    hosts: { list(args: { includeCreating: boolean; signal: AbortSignal }): Promise<HostFacts[]> };
    threads: { count(args: { hostId: string; status: ThreadStatus; signal: AbortSignal }): Promise<{ total: number }> };
  };
  experimental_machines: { getResource(hostId: string): Promise<JsonValue | null> };
}

export interface ObserveDeps {
  bb: ObserveBb;
  idle: Pick<IdleClock, "read">;
  ownerId: string;
}

/** A thread in any of these is working, however quiet: a 20-minute silent tool call stays `active`. */
const BUSY_STATUSES: readonly ThreadStatus[] = ["pending", "starting", "active", "stopping"];

/**
 * bb first, boat second: a sandbox a create makes in between is then new on boat, and new sandboxes
 * are never taken for leaks.
 */
export async function observe(deps: ObserveDeps, client: BoatClient, signal: AbortSignal): Promise<SweepInput> {
  const hosts = await observeHosts(deps, signal);
  return { hosts, sandboxes: await observeSandboxes(client, deps.ownerId, hosts, signal) };
}

async function observeHosts(deps: ObserveDeps, signal: AbortSignal): Promise<HostView[]> {
  const hosts = (await deps.bb.sdk.hosts.list({ includeCreating: true, signal })).filter(
    (host) => host.machineProviderId === PROVIDER_ID,
  );
  return (await Promise.all(hosts.map((host) => observeHost(deps, host, signal)))).filter((view) => view !== null);
}

/** null for a create that has not checkpointed yet: it has no sandbox to look after. */
export async function observeHost({ bb, idle }: ObserveDeps, host: HostFacts, signal: AbortSignal): Promise<HostView | null> {
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
async function isBusy(bb: ObserveBb, hostId: string, signal: AbortSignal): Promise<boolean> {
  const counts = await Promise.all(BUSY_STATUSES.map((status) => bb.sdk.threads.count({ hostId, status, signal })));
  return counts.some(({ total }) => total > 0);
}

/**
 * Every machine sandbox carrying this server's owner label, then each machine's sandbox the listing
 * missed: one made under an earlier owner id (the plugin's storage was reset) is still the machine's.
 */
async function observeSandboxes(
  client: BoatClient,
  ownerId: string,
  hosts: readonly HostView[],
  signal: AbortSignal,
): Promise<Map<SandboxId, Sandbox>> {
  const sandboxes = new Map((await client.list(ownerLabels(ownerId), signal)).map((sandbox) => [sandbox.id, sandbox]));
  const missed = hosts.map((host) => host.sandboxId).filter((id) => !sandboxes.has(id));
  for (const sandbox of await Promise.all(missed.map((id) => client.get(id, signal))))
    if (sandbox !== null) sandboxes.set(sandbox.id, sandbox);
  return sandboxes;
}

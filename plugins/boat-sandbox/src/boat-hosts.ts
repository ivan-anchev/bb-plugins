// Which bb hosts are boat machines, so the sidebar can mark the threads that run on one.
import type { BbPluginApi, ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { PROVIDER_ID, type boatSandboxContract } from "./contract.ts";

type Host = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>[number];
type HostFacts = Pick<Host, "id" | "machineProviderId">;

/** What answering asks of bb; `bb.sdk.hosts` is one. */
export interface HostLister {
  list(args: { includeCreating: boolean; signal: AbortSignal }): Promise<HostFacts[]>;
}

/** Every key answers: true for a boat machine, false for any other host or one bb does not list. */
export function markBoatHosts(keys: readonly string[], hosts: readonly HostFacts[]): Record<string, boolean> {
  const boat = new Set(hosts.filter((host) => host.machineProviderId === PROVIDER_ID).map((host) => host.id));
  return Object.fromEntries(keys.map((key) => [key, boat.has(key)]));
}

export const boatHostsRpcHandlers = (hosts: HostLister): Pick<ExperimentalPluginRpcHandlersWithContext<typeof boatSandboxContract>, "boatHosts"> => ({
  boatHosts: async ({ keys }, { experimental_signal: signal }) => markBoatHosts(keys, await hosts.list({ includeCreating: true, signal })),
});

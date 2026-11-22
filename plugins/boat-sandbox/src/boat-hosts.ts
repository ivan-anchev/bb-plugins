import type { BbPluginApi, ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import { PROVIDER_ID, type boatSandboxContract } from "./contract.ts";

type Sdk = BbPluginApi["sdk"];
type Host = Awaited<ReturnType<Sdk["hosts"]["list"]>>[number];
type HostFacts = Pick<Host, "id" | "machineProviderId">;
type Environment = Awaited<ReturnType<Sdk["environments"]["get"]>>;

/** What answering asks of bb; `bb.sdk.hosts` is one. */
export interface HostLister {
  list(args: { includeCreating: boolean; signal: AbortSignal }): Promise<HostFacts[]>;
}

/** What finding an environment's boat machine asks of bb; `bb.sdk` is one. */
export interface EnvironmentHostReader {
  environments: { get(args: { environmentId: string; signal: AbortSignal }): Promise<Pick<Environment, "hostId">> };
  hosts: { get(args: { hostId: string; signal: AbortSignal }): Promise<HostFacts> };
}

/** Every key answers: true for a boat machine, false for any other host or one bb does not list. */
export function markBoatHosts(keys: readonly string[], hosts: readonly HostFacts[]): Record<string, boolean> {
  const boat = new Set(hosts.filter((host) => host.machineProviderId === PROVIDER_ID).map((host) => host.id));
  return Object.fromEntries(keys.map((key) => [key, boat.has(key)]));
}

/** The bb host the environment runs on, when that host is a boat machine; null for any other. */
export async function boatHostOf(sdk: EnvironmentHostReader, environmentId: string, signal: AbortSignal): Promise<string | null> {
  const { hostId } = await sdk.environments.get({ environmentId, signal });
  const host = await sdk.hosts.get({ hostId, signal });
  return host.machineProviderId === PROVIDER_ID ? host.id : null;
}

type Handlers = ExperimentalPluginRpcHandlersWithContext<typeof boatSandboxContract>;

export const boatHostsRpcHandlers = (sdk: EnvironmentHostReader & { hosts: HostLister }): Pick<Handlers, "boatHosts" | "boatEnvironments"> => ({
  boatHosts: async ({ keys }, { experimental_signal: signal }) => markBoatHosts(keys, await sdk.hosts.list({ includeCreating: true, signal })),
  boatEnvironments: async ({ keys }, { experimental_signal: signal }) =>
    Object.fromEntries(await Promise.all(keys.map(async (key) => [key, (await boatHostOf(sdk, key, signal)) !== null] as const))),
});

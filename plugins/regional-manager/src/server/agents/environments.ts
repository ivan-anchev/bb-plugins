// What bb says about environments, from its own records, never reaching a machine: whether one is
// gone, and, read when agent_start names an environment provider, where a regional manager's agents
// can run: bb's providers, and the project's default branch as bb records it on the regional
// manager's environment.
import type { EnvironmentProvider, PlacementFacts } from "../../model/agent.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";
import { listedThreads } from "./threads.ts";

type ListedThread = { id: string; environmentId: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb the facts come from. */
type PlacementFactsBb = {
  sdk: {
    threads: { list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]> };
    environments: {
      listProviders(): Promise<readonly EnvironmentProvider[]>;
      get(args: { environmentId: string }): Promise<{ defaultBranch: string | null }>;
    };
  };
};

export function placementFactsReader(bb: PlacementFactsBb, store: Pick<Store, "coordinator">) {
  /** The project's default branch, as bb records it on the regional manager's environment; null when it records none. */
  async function defaultBranch(id: CoordinatorId): Promise<string | null> {
    const coordinator = store.coordinator(id);
    // why throw: only a regional manager's tools ask, by its own id.
    if (coordinator === null) throw new Error(`No regional manager ${id}.`);
    const environmentId = (await listedThreads(bb, [coordinator.threadId])).get(coordinator.threadId)?.environmentId ?? null;
    return environmentId === null ? null : (await bb.sdk.environments.get({ environmentId })).defaultBranch;
  }

  return async (id: CoordinatorId): Promise<PlacementFacts> => {
    const [providers, branch] = await Promise.all([bb.sdk.environments.listProviders(), defaultBranch(id)]);
    return { providers, defaultBranch: branch };
  };
}

/** The part of bb the read uses. */
export type EnvironmentsBb = { sdk: { environments: { get(args: { environmentId: string }): Promise<{ status: string }> } } };

/** Whether bb has destroyed the environment, as when a sandbox is removed: no turn can run there again. */
export async function environmentGone(bb: EnvironmentsBb, environmentId: string): Promise<boolean> {
  return (await bb.sdk.environments.get({ environmentId })).status === "destroyed";
}

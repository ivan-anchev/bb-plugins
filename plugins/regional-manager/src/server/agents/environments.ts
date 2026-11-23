// What bb says about environments, from its own records, never reaching a machine: whether one is
// gone; the project's default branch as bb records it on the regional manager's environment, which
// a final check is made on; and, read when agent_start names an environment provider, where a
// regional manager's agents can run: bb's providers, and that default branch.
import type { EnvironmentProvider, PlacementFacts } from "../../model/agent/agent.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";
import { listedThreads } from "./threads.ts";

type ListedThread = { id: string; environmentId: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb the default branch is read from: the regional manager's thread, and its environment's record. */
type DefaultBranchBb = {
  sdk: {
    threads: { list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]> };
    environments: { get(args: { environmentId: string }): Promise<{ defaultBranch: string | null }> };
  };
};

/** The parts of bb the facts come from. */
type PlacementFactsBb = DefaultBranchBb & { sdk: { environments: { listProviders(): Promise<readonly EnvironmentProvider[]> } } };

/** Reads the project's default branch, as bb records it on the regional manager's environment; null when it records none. */
export function defaultBranchReader(bb: DefaultBranchBb, store: Pick<Store, "coordinator">) {
  return async (id: CoordinatorId): Promise<string | null> => {
    const coordinator = store.coordinator(id);
    // why throw: callers ask by the id of a regional manager they read.
    if (coordinator === null) throw new Error(`No regional manager ${id}.`);
    const environmentId = (await listedThreads(bb, [coordinator.threadId])).get(coordinator.threadId)?.environmentId ?? null;
    return environmentId === null ? null : (await bb.sdk.environments.get({ environmentId })).defaultBranch;
  };
}

export function placementFactsReader(bb: PlacementFactsBb, store: Pick<Store, "coordinator">) {
  const defaultBranch = defaultBranchReader(bb, store);
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

// What bb says about where a coordinating thread's crews can run, read when crew_start names an
// environment provider: bb's providers, and the project's default branch as bb records it on the
// coordinating thread's environment. Both come from bb's own records; neither reaches a machine.
import type { EnvironmentProvider, PlacementFacts } from "../../model/crew.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store.ts";
import { listedThreads } from "./board/board.ts";

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
  /** The project's default branch, as bb records it on the coordinating thread's environment; null when it records none. */
  async function defaultBranch(id: CoordinatorId): Promise<string | null> {
    const coordinator = store.coordinator(id);
    // why throw: only a coordinating thread's tools ask, by its own id.
    if (coordinator === null) throw new Error(`No coordinating thread ${id}.`);
    const environmentId = (await listedThreads(bb, [coordinator.threadId])).get(coordinator.threadId)?.environmentId ?? null;
    return environmentId === null ? null : (await bb.sdk.environments.get({ environmentId })).defaultBranch;
  }

  return async (id: CoordinatorId): Promise<PlacementFacts> => {
    const [providers, branch] = await Promise.all([bb.sdk.environments.listProviders(), defaultBranch(id)]);
    return { providers, defaultBranch: branch };
  };
}

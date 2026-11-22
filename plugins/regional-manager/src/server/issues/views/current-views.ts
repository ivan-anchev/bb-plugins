import type { IssueView } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Store } from "../../store/store.ts";
import { readIssues, type FactsBb, type FactsStore } from "./issue-facts.ts";

const READS = 3;

type Deps = { bb: FactsBb & { onDispose(hook: () => void): void }; store: FactsStore & Pick<Store, "factWrites"> };

export type CurrentViews = ReturnType<typeof currentViews>;

export function currentViews({ bb, store }: Deps) {
  const moves = new Map<CoordinatorId, number>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  const movesOf = (id: CoordinatorId): number => moves.get(id) ?? 0;
  const changesOf = (id: CoordinatorId) => ({ writes: store.factWrites(id), moves: movesOf(id) });
  const changedSince = (id: CoordinatorId, before: ReturnType<typeof changesOf>): boolean => store.factWrites(id) !== before.writes || movesOf(id) !== before.moves;

  return {
    changed(id: CoordinatorId): void {
      moves.set(id, movesOf(id) + 1);
    },

    async whileCurrent<R>(id: CoordinatorId, act: (views: IssueView[]) => R): Promise<{ acted: R } | null> {
      for (let read = 0; read < READS && !disposed; read++) {
        const before = changesOf(id);
        const views = (await readIssues(bb, store, id)).map(({ view }) => view);
        if (disposed || changedSince(id, before)) continue;
        return { acted: act(views) };
      }
      return null;
    },
  };
}

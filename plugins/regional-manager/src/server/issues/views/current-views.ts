// Every issue of a regional manager, viewed, handed to whatever acts on the views (a plan write, the
// unblocked announcement) only while they are current: no change to what they are derived from came
// between the read and the act. Reading every issue awaits bb, and a status derived from bb (a
// report whose turn ended, a merge, a parent's sub-issues) can move meanwhile; an act judged on a
// read overtaken so would admit or refuse, or record, what is no longer so. A change is either a
// write to the store, which counts itself as it commits (migrations.ts fact_writes), or an agent
// thread moving in bb, which the store never records (changed).
import type { IssueView } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Store } from "../../store/store.ts";
import { readIssues, type FactsBb, type FactsStore } from "./issue-facts.ts";

/**
 * How many reads one act makes while changes keep overtaking them. why a bound: a manager whose
 * agents keep changing things must not hold the tick from every other manager and the doorbells,
 * nor a tool call from answering.
 */
const READS = 3;

type Deps = { bb: FactsBb & { onDispose(hook: () => void): void }; store: FactsStore & Pick<Store, "factWrites"> };

export type CurrentViews = ReturnType<typeof currentViews>;

export function currentViews({ bb, store }: Deps) {
  /** How many times one of each regional manager's agent threads moved in bb, as far as the plugin knows. */
  const moves = new Map<CoordinatorId, number>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  const movesOf = (id: CoordinatorId): number => moves.get(id) ?? 0;
  /** Where the regional manager's changes stand: a read is current while they stand as they did when it began. */
  const changesOf = (id: CoordinatorId) => ({ writes: store.factWrites(id), moves: movesOf(id) });
  const changedSince = (id: CoordinatorId, before: ReturnType<typeof changesOf>): boolean => store.factWrites(id) !== before.writes || movesOf(id) !== before.moves;

  return {
    /** One of the regional manager's agent threads moved in bb (a turn started or ended, a message sent to it): a read begun before it is no longer current. */
    changed(id: CoordinatorId): void {
      moves.set(id, movesOf(id) + 1);
    },

    /**
     * Reads every issue of the regional manager, again while a change came during the read, and
     * hands the first read no change overtook to `act`: what it returns, or null when READS reads
     * were overtaken, or the plugin was disposed, and nothing was acted on.
     */
    async whileCurrent<R>(id: CoordinatorId, act: (views: IssueView[]) => R): Promise<{ acted: R } | null> {
      for (let read = 0; read < READS && !disposed; read++) {
        const before = changesOf(id);
        const views = (await readIssues(bb, store, id)).map(({ view }) => view);
        if (disposed || changedSince(id, before)) continue;
        // why no await between the check and the act: no change can come in between.
        return { acted: act(views) };
      }
      return null;
    },
  };
}

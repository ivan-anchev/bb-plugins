// Every issue of a regional manager, viewed, handed to whatever acts on the views (a plan write, the
// unblocked announcement) only while they are current: no change to what they are derived from came
// between the read and the act. Reading every issue awaits bb, and a status derived from bb (a
// report whose turn ended, a merge, a parent's sub-issues) can move meanwhile; an act judged on a
// read overtaken so would admit or refuse, or record, what is no longer so.
import type { IssueView } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { readIssues, type FactsBb, type FactsStore } from "./issue-facts.ts";

/**
 * How many reads one act makes while changes keep overtaking them. why a bound: a manager whose
 * agents keep changing things must not hold the tick from every other manager and the doorbells,
 * nor a tool call from answering.
 */
const READS = 3;

type Deps = { bb: FactsBb & { onDispose(hook: () => void): void }; store: FactsStore };

export type CurrentViews = ReturnType<typeof currentViews>;

export function currentViews({ bb, store }: Deps) {
  /** How many changes each regional manager's views have seen: a read is current while this stays as it was when the read began. */
  const changes = new Map<CoordinatorId, number>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  const changesOf = (id: CoordinatorId): number => changes.get(id) ?? 0;

  return {
    /** Something the regional manager's views are derived from changed: a read begun before it is no longer current. */
    changed(id: CoordinatorId): void {
      changes.set(id, changesOf(id) + 1);
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
        if (disposed || changesOf(id) !== before) continue;
        // why no await between the check and the act: no change can come in between.
        return { acted: act(views) };
      }
      return null;
    },
  };
}

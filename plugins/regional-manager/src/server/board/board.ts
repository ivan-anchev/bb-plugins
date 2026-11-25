// The board: every issue of a regional manager, viewed now, with its latest agent's thread. Read
// whole on every call; bb's thread events only say when to read again.
import type { Board, IssueRow } from "../../contract.ts";
import { needsYou, type NeedsYou } from "../../model/board/board-groups.ts";
import { openIssues, type OpenIssues } from "../../model/board/open-issues.ts";
import { warnedFileCount } from "../../model/inbox/own-tree.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { readIssues, type FactsBb, type FactsStore, type IssueRead } from "../issues/views/issue-facts.ts";
import type { Store } from "../store/store.ts";

type BoardStore = FactsStore & Pick<Store, "verifies" | "lastOwnTreeEvent">;

/** An issue's row on the board. */
const rowOf = ({ view, agent, threadId }: IssueRead): IssueRow => ({
  id: view.issue.id,
  kind: view.issue.kind,
  parentId: view.issue.parentId,
  subIssues: view.subIssues,
  blockedBy: view.blockedBy.map(({ id }) => id),
  blocks: view.blocks.map(({ id }) => id),
  title: view.issue.title,
  status: view.status,
  needsYou: view.needsYou,
  headline: view.headline,
  agent: agent === null ? null : { id: agent.id, threadId },
  pr: view.pr,
});

export function createBoard(bb: FactsBb, store: BoardStore) {
  /** Why the latest read of an open issue's pull request failed, the first one's; null when none did. */
  function prUnavailable(id: CoordinatorId, reads: readonly IssueRead[]): string | null {
    for (const { view, branch } of reads) {
      if (view.issue.closed !== null || branch === null) continue;
      const unavailable = store.prOfBranch(id, branch)?.unavailable ?? null;
      if (unavailable !== null) return unavailable.reason;
    }
    return null;
  }

  /** The warning of changed files in the regional manager's own working tree, from the latest event about it. */
  function ownEdits(id: CoordinatorId): Board["ownEdits"] {
    const last = store.lastOwnTreeEvent(id);
    const fileCount = warnedFileCount(last?.event ?? null);
    return last === null || fileCount === 0 ? null : { fileCount, at: last.at };
  }

  return {
    /** Every issue of the regional manager, viewed now. */
    issues: (id: CoordinatorId): Promise<IssueRead[]> => readIssues(bb, store, id),

    /** The board as the user sees it: the verification switch, the warning of its own edits, why PR status is unavailable, the decisions, then every issue's row. */
    async read(id: CoordinatorId): Promise<Board> {
      const reads = await readIssues(bb, store, id);
      return {
        verify: store.verifies(id),
        ownEdits: ownEdits(id),
        prUnavailable: prUnavailable(id, reads),
        decisions: store.decisions(id),
        issues: reads.map(rowOf),
      };
    },

    /** What sits under Needs you on the board, from the same reads as the board's own: its decisions and its issues. */
    async needsYou(id: CoordinatorId): Promise<NeedsYou> {
      return needsYou(store.decisions(id), (await readIssues(bb, store, id)).map((read) => read.view));
    },

    /** Its open work, as another plugin reads it, from the board's own rows. */
    async openIssues(id: CoordinatorId): Promise<OpenIssues> {
      return openIssues(store.decisions(id), (await readIssues(bb, store, id)).map(rowOf));
    },
  };
}

export type BoardReader = ReturnType<typeof createBoard>;

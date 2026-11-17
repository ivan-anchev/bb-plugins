// The board: every issue of a regional manager, viewed now, with its latest agent's thread, and the
// digest; and one issue opened on it, with its record. Read whole on every call; bb's thread events
// only say when to read again.
import type { Board, IssueDetail, IssueRow } from "../../contract.ts";
import type { Agent } from "../../model/agent.ts";
import { needsYou, type NeedsYou } from "../../model/board/board-groups.ts";
import { warnedFileCount } from "../../model/inbox/own-tree.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { Handed } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { shownVerdict } from "../../model/verdict/verdict.ts";
import { readIssues, type FactsBb, type FactsStore, type IssueRead } from "../issues/issue-facts.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store/store.ts";

const DIGEST = memoryFileSchema.parse("DIGEST.md");

type BoardStore = FactsStore & Pick<Store, "verifies" | "lastOwnTreeEvent" | "issue" | "record">;

/** An issue's row on the board. */
const rowOf = ({ view, agent, threadId, branch }: IssueRead): IssueRow => ({
  id: view.issue.id,
  kind: view.issue.kind,
  title: view.issue.title,
  status: view.status,
  needsYou: view.needsYou,
  headline: view.headline,
  agent: agent === null ? null : { id: agent.id, threadId },
  branch,
  pr: view.pr,
});

/** An agent in an issue's record. why no thread once deleted: there is nothing left to open. */
const heldBy = ({ id, threadId, ended }: Agent): IssueDetail["record"][number]["agent"] => ({
  id,
  threadId: ended?.how === "deleted" ? null : threadId,
  ended: ended?.how ?? null,
});

/** A handoff in an issue's record, with the verdict on it as the user is shown it. */
const shownHanded = ({ handoff: { id, at, status, summary, did, evidence, concerns, deviations, findings }, check }: Handed): IssueDetail["record"][number]["handoffs"][number] => ({
  id,
  at,
  status,
  summary,
  did,
  evidence,
  concerns,
  deviations,
  findings,
  verdict: check === null ? null : shownVerdict(check.verdict),
});

export function createBoard(bb: FactsBb, store: BoardStore, memory: MemoryRoot) {
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

    /** The board as the user sees it: the verification switch, the warning of its own edits, why PR status is unavailable, the digest, the decisions, then every issue's row. */
    async read(id: CoordinatorId): Promise<Board> {
      const files = memory.of(id);
      const text = files.read(DIGEST).text;
      const modifiedAt = files.modifiedAt(DIGEST);
      const reads = await readIssues(bb, store, id);
      return {
        verify: store.verifies(id),
        ownEdits: ownEdits(id),
        prUnavailable: prUnavailable(id, reads),
        digest: text === null || modifiedAt === null ? null : { content: text.content, modifiedAt },
        decisions: store.decisions(id),
        issues: reads.map(rowOf),
      };
    },

    /** An issue opened on the board: its plan for the user and its record, from the store alone (null: the regional manager has no such issue). */
    detail(id: CoordinatorId, issueId: IssueId): IssueDetail | null {
      const issue = store.issue(id, issueId);
      if (issue === null) return null;
      const record = store.record(id, issueId);
      return {
        description: issue.description,
        doneCriteria: issue.doneCriteria,
        record: store
          .agents(id)
          .filter((agent) => agent.issueId === issueId)
          .map((agent) => ({ agent: heldBy(agent), handoffs: record.filter(({ handoff }) => handoff.agentId === agent.id).map(shownHanded) })),
      };
    },

    /** What sits under Needs you on the board, from the same reads as the board's own: its decisions and its issues. */
    async needsYou(id: CoordinatorId): Promise<NeedsYou> {
      return needsYou(store.decisions(id), (await readIssues(bb, store, id)).map((read) => read.view));
    },
  };
}

export type BoardReader = ReturnType<typeof createBoard>;

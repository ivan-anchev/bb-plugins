// The board: every issue of a regional manager, viewed now, with its latest agent's thread, and the
// digest; and one issue opened on it, with its record. Read whole on every call; bb's thread events
// only say when to read again.
import type { Board, IssueDetail, IssueRow } from "../../contract.ts";
import type { Agent } from "../../model/agent.ts";
import type { HandoffReport } from "../../model/handoff.ts";
import { needsYou, type NeedsYou } from "../../model/board/board-groups.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import { dependentsOf } from "../../model/issue/relations.ts";
import type { Handed } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { shownVerdict } from "../../model/verdict/verdict.ts";
import { threadsById } from "../agents/threads.ts";
import { readIssues, type FactsBb, type FactsStore, type IssueRead } from "../issues/views/issue-facts.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store/store.ts";

const DIGEST = memoryFileSchema.parse("DIGEST.md");

type BoardStore = FactsStore & Pick<Store, "verifies" | "issue" | "record">;

/** An issue's row on the board. */
const rowOf = ({ view, agent, threadId }: IssueRead): IssueRow => ({
  id: view.issue.id,
  kind: view.issue.kind,
  parentId: view.issue.parentId,
  subIssues: view.subIssues,
  blockedBy: view.blockedBy.map(({ id }) => id),
  title: view.issue.title,
  status: view.status,
  needsYou: view.needsYou,
  headline: view.headline,
  agent: agent === null ? null : { id: agent.id, threadId },
  pr: view.pr,
});

/**
 * An agent in an issue's record, with its thread while bb still has it, archived or not (`threads`:
 * the record's threads as bb lists them now). why bb's listing, not how the agent ended: a thread
 * archived or kept when its agent ended may be deleted since, and the agent's record never says so.
 */
const heldBy = ({ id, threadId, ended }: Agent, threads: ReadonlyMap<string, { id: string; deletedAt: number | null }>): IssueDetail["record"][number]["agent"] => {
  const thread = threadId === null ? undefined : threads.get(threadId);
  return { id, threadId: thread === undefined || thread.deletedAt !== null ? null : thread.id, ended: ended?.how ?? null };
};

type ShownHanded = IssueDetail["record"][number]["handoffs"][number];

/** A handoff in an issue's record, with the report it delivered and the verdict on it as the user is shown them. */
const shownHanded = ({ handoff, check }: Handed): ShownHanded => {
  const { id, at, status, summary, did, evidence, concerns, deviations, findings } = handoff;
  return { id, at, status, summary, did, evidence, concerns, deviations, findings, report: reportIn(handoff), verdict: check === null ? null : shownVerdict(check.verdict) };
};

/** The report a done handoff delivered, and the file it was saved to; null for any other handoff. */
function reportIn(handoff: HandoffReport): ShownHanded["report"] {
  if (handoff.status !== "done") return null;
  const { delivery } = handoff;
  switch (delivery.kind) {
    case "commit":
      return null;
    case "report":
      return { report: delivery.report, file: delivery.file };
    default:
      return delivery satisfies never;
  }
}

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

  return {
    /** Every issue of the regional manager, viewed now. */
    issues: (id: CoordinatorId): Promise<IssueRead[]> => readIssues(bb, store, id),

    /** The board as the user sees it: the verification switch, why PR status is unavailable, the digest, the decisions, then every issue's row. */
    async read(id: CoordinatorId): Promise<Board> {
      const files = memory.of(id);
      const text = files.read(DIGEST).text;
      const modifiedAt = files.modifiedAt(DIGEST);
      const reads = await readIssues(bb, store, id);
      return {
        verify: store.verifies(id),
        prUnavailable: prUnavailable(id, reads),
        digest: text === null || modifiedAt === null ? null : { content: text.content, modifiedAt },
        decisions: store.decisions(id),
        issues: reads.map(rowOf),
      };
    },

    /** An issue opened on the board: its plan for the user, what it depends on and what depends on it, its record and a build parent's final checks, from the store, with its agents' threads as bb lists them (null: the regional manager has no such issue). */
    async detail(id: CoordinatorId, issueId: IssueId): Promise<IssueDetail | null> {
      const issue = store.issue(id, issueId);
      if (issue === null) return null;
      const record = store.record(id, issueId);
      const agents = store.agents(id).filter((agent) => agent.issueId === issueId);
      const threads = await threadsById(bb, agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])));
      return {
        description: issue.description,
        doneCriteria: issue.doneCriteria,
        dependsOn: issue.dependsOn,
        blocks: dependentsOf(store.issues(id), issueId),
        record: agents.map((agent) => ({ agent: heldBy(agent, threads), handoffs: record.filter(({ handoff }) => handoff.agentId === agent.id).map(shownHanded) })),
        finalChecks: store.finalChecks(id, issueId).map(({ at, subject, verdict }) => ({ at, defaultBranch: subject.defaultBranch, verdict: shownVerdict(verdict) })),
      };
    },

    /** What sits under Needs you on the board, from the same reads as the board's own: its decisions and its issues. */
    async needsYou(id: CoordinatorId): Promise<NeedsYou> {
      return needsYou(store.decisions(id), (await readIssues(bb, store, id)).map((read) => read.view));
    },
  };
}

export type BoardReader = ReturnType<typeof createBoard>;

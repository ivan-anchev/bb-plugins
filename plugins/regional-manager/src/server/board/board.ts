import type { Board, IssueDetail, IssueRow } from "../../contract.ts";
import type { Agent } from "../../model/agent.ts";
import type { HandoffReport } from "../../model/handoff.ts";
import { needsYou, type NeedsYou } from "../../model/board/board-groups.ts";
import { warnedFileCount } from "../../model/inbox/own-tree.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import { dependentsOf } from "../../model/issue/relations.ts";
import type { Handed } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { shownVerdict } from "../../model/verdict/verdict.ts";
import { threadsById } from "../agents/threads.ts";
import { readIssues, type FactsBb, type FactsStore, type IssueRead } from "../issues/views/issue-facts.ts";
import type { Store } from "../store/store.ts";

type BoardStore = FactsStore & Pick<Store, "verifies" | "lastOwnTreeEvent" | "issue" | "record" | "issueDecisions">;

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

const heldBy = ({ id, threadId, ended }: Agent, threads: ReadonlyMap<string, { id: string; deletedAt: number | null }>): IssueDetail["record"][number]["agent"] => {
  const thread = threadId === null ? undefined : threads.get(threadId);
  return { id, threadId: thread === undefined || thread.deletedAt !== null ? null : thread.id, ended: ended?.how ?? null };
};

type ShownHanded = IssueDetail["record"][number]["handoffs"][number];

const shownHanded = ({ handoff, check }: Handed): ShownHanded => {
  const { id, at, status, summary, did, evidence, concerns, deviations, findings } = handoff;
  return { id, at, status, summary, did, evidence, concerns, deviations, findings, report: reportIn(handoff), verdict: check === null ? null : shownVerdict(check.verdict) };
};

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

export function createBoard(bb: FactsBb, store: BoardStore) {
  function prUnavailable(id: CoordinatorId, reads: readonly IssueRead[]): string | null {
    for (const { view, branch } of reads) {
      if (view.issue.closed !== null || branch === null) continue;
      const unavailable = store.prOfBranch(id, branch)?.unavailable ?? null;
      if (unavailable !== null) return unavailable.reason;
    }
    return null;
  }

  function ownEdits(id: CoordinatorId): Board["ownEdits"] {
    const last = store.lastOwnTreeEvent(id);
    const fileCount = warnedFileCount(last?.event ?? null);
    return last === null || fileCount === 0 ? null : { fileCount, at: last.at };
  }

  return {
    issues: (id: CoordinatorId): Promise<IssueRead[]> => readIssues(bb, store, id),

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

    async detail(id: CoordinatorId, issueId: IssueId): Promise<IssueDetail | null> {
      const issue = store.issue(id, issueId);
      if (issue === null) return null;
      const record = store.record(id, issueId);
      const agents = store.agents(id).filter((agent) => agent.issueId === issueId);
      const threads = await threadsById(bb, agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])));
      return {
        description: issue.description,
        doneCriteria: issue.doneCriteria,
        decisions: store.issueDecisions(id, issueId),
        dependsOn: issue.dependsOn,
        blocks: dependentsOf(store.issues(id), issueId),
        record: agents.map((agent) => ({ agent: heldBy(agent, threads), handoffs: record.filter(({ handoff }) => handoff.agentId === agent.id).map(shownHanded) })),
        finalChecks: store.finalChecks(id, issueId).map(({ at, subject, verdict }) => ({ at, defaultBranch: subject.defaultBranch, verdict: shownVerdict(verdict) })),
      };
    },

    async needsYou(id: CoordinatorId): Promise<NeedsYou> {
      return needsYou(store.decisions(id), (await readIssues(bb, store, id)).map((read) => read.view));
    },
  };
}

export type BoardReader = ReturnType<typeof createBoard>;

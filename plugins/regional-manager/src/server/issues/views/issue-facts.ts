// Every issue of a regional manager, viewed: one store read, one listing of its agents' and running
// verifiers' threads, and a turn read only for a holder that is idle with a handoff to judge. The
// board, crew_catch_up, issue_read, issue_update and the unblocked announcement all view issues
// here, so a status has one derivation.
import { issueBranch, type Agent } from "../../../model/agent/agent.ts";
import { isOpen, type Decision } from "../../../model/decision.ts";
import type { Issue } from "../../../model/issue/issue.ts";
import { issueViews, type Handed, type HolderThread, type IssueFacts, type IssueView } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Store } from "../../store/store.ts";
import { ifCurrent, isLive, threadsById, type ListBb, type TurnsBb } from "../../agents/threads.ts";

/** An agent's or a running verifier's thread as the views read it. */
type ListedThread = HolderThread & { id: string; environmentBranchName: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb the views read: the agents' threads and their turns. */
export type FactsBb = ListBb<ListedThread> & TurnsBb;

export type FactsStore = Pick<Store, "issues" | "agents" | "decisions" | "record" | "prOfBranch" | "finalChecks" | "openChecks">;

/**
 * One issue, viewed, with its latest agent (null: none started), that agent's thread while bb runs
 * it (null: none, archived or deleted), and the branch its pull request is read on (null: none on
 * record), and every handoff on its record with its check, from the same read as its view, so what
 * is said of a check never disagrees with the status shown.
 */
export type IssueRead = { view: IssueView; agent: Agent | null; threadId: string | null; branch: string | null; record: readonly Handed[] };

/** Every issue of the regional manager, in the order filed, viewed now. */
export const readIssues = async (bb: FactsBb, store: FactsStore, coordinatorId: CoordinatorId): Promise<IssueRead[]> => (await readBoard(bb, store, coordinatorId)).reads;

/**
 * Every issue of the regional manager, in the order filed, viewed now, with `decisions`, every
 * decision put to the user as the views read them. why together: the board, the rail badge and
 * crew_catch_up place questions and issues from one snapshot, so a cap question asked during the
 * host read never shows without its issue's reason, nor the reason without the question.
 */
export async function readBoard(bb: FactsBb, store: FactsStore, coordinatorId: CoordinatorId): Promise<{ reads: IssueRead[]; decisions: Decision[] }> {
  const issues = store.issues(coordinatorId);
  const agents = store.agents(coordinatorId);
  const verifiers = store.openChecks().flatMap(({ coordinatorId: of, issueId, verdict }) => (of === coordinatorId && verdict.state === "running" ? [{ issueId, threadId: verdict.verifierThreadId }] : []));
  // why archived ones too: an ended agent's branch still names its issue's pull request.
  const threads = await threadsById(bb, [...agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])), ...verifiers.map(({ threadId }) => threadId)]);
  const threadOf = (agent: Agent): ListedThread | null => (agent.threadId === null ? null : (threads.get(agent.threadId) ?? null));
  const decisions = store.decisions(coordinatorId);

  const reads = await Promise.all(
    issues.map(async (issue) => {
      // why first, before this issue's awaits: its view and its record are one read.
      const record = store.record(coordinatorId, issue.id);
      const own = agents.filter((agent) => agent.issueId === issue.id);
      const latest = own.at(-1) ?? null;
      const branch = issueBranch(own, threadOf)?.branch ?? null;
      const facts: IssueFacts = {
        issue,
        holder: await holderOf(bb, own, threadOf, record),
        ended: endedBy(latest, record),
        pr: branch === null ? null : (store.prOfBranch(coordinatorId, branch)?.snapshot ?? null),
        openDecisions: decisions.filter((decision) => decision.issueId === issue.id && isOpen(decision)),
        finalCheck: store.finalChecks(coordinatorId, issue.id).at(-1) ?? null,
        verifierAsks: verifiers.some(({ issueId, threadId }) => issueId === issue.id && threads.get(threadId)?.hasPendingInteraction === true),
      };
      const live = latest === null ? null : threadOf(latest);
      return { facts, agent: latest, threadId: live !== null && isLive(live) ? live.id : null, branch, record };
    }),
  );
  const views = issueViews(reads.map(({ facts }) => facts));
  return { reads: reads.map(({ agent, threadId, branch, record }, i) => ({ view: viewAt(views, i), agent, threadId, branch, record })), decisions };
}

/** The issue's holder, its thread while bb runs it, and its current handoff (its latest on `record`), judged only when its thread is idle. */
async function holderOf(bb: TurnsBb, own: readonly Agent[], threadOf: (agent: Agent) => ListedThread | null, record: readonly Handed[]): Promise<IssueFacts["holder"]> {
  const agent = own.find(({ ended }) => ended === null);
  if (agent === undefined) return null;
  const listed = threadOf(agent);
  const thread = listed !== null && isLive(listed) ? listed : null;
  const latest = record.filter(({ handoff }) => handoff.agentId === agent.id).at(-1) ?? null;
  const current = thread?.status === "idle" ? await ifCurrent(bb, thread.id, latest) : null;
  return { agent, thread, current };
}

/** How the latest agent ended, with the handoff it left then, from `record` (null: none); null while it holds the issue, or when none started. */
function endedBy(latest: Agent | null, record: readonly Handed[]): IssueFacts["ended"] {
  const ended = latest?.ended ?? null;
  if (ended === null) return null;
  return { how: ended.how, left: record.find(({ handoff }) => handoff.id === ended.left) ?? null };
}

/** why throw: issueViews returns one view per facts, in order. */
function viewAt(views: readonly IssueView[], i: number): IssueView {
  const view = views[i];
  if (view === undefined) throw new Error(`No view for issue ${i}`);
  return view;
}

/** One issue of the regional manager, viewed now. */
export async function readIssue(bb: FactsBb, store: FactsStore, issue: Pick<Issue, "coordinatorId" | "id">): Promise<IssueRead> {
  const read = (await readIssues(bb, store, issue.coordinatorId)).find(({ view }) => view.issue.id === issue.id);
  // why throw: callers read the issue from the store first, and issues are never deleted while their regional manager is kept.
  if (read === undefined) throw new Error(`The issue ${issue.id} of ${issue.coordinatorId} is missing.`);
  return read;
}

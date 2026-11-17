// Every issue of a regional manager, viewed: one store read, one listing of its agents' threads, and
// a turn read only for a holder that is idle with a handoff to judge. The board, crew_catch_up,
// issue_read and issue_update all view issues here, so a status has one derivation.
import { issueBranch, type Agent } from "../../model/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import { issueViews, type HolderThread, type IssueFacts, type IssueView } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";
import { ifCurrent, isLive, threadsById, type ListBb, type TurnsBb } from "../agents/threads.ts";

/** An agent's thread as the views read it. */
type ListedThread = HolderThread & { id: string; environmentBranchName: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb the views read: the agents' threads and their turns. */
export type FactsBb = ListBb<ListedThread> & TurnsBb;

export type FactsStore = Pick<Store, "issues" | "agents" | "decisions" | "latestHandoff" | "handoff" | "prOfBranch">;

/**
 * One issue, viewed, with its latest agent (null: none started), that agent's thread while bb runs
 * it (null: none, archived or deleted), and the branch its pull request is read on (null: none on
 * record).
 */
export type IssueRead = { view: IssueView; agent: Agent | null; threadId: string | null; branch: string | null };

/** Every issue of the regional manager, in the order filed, viewed now. */
export async function readIssues(bb: FactsBb, store: FactsStore, coordinatorId: CoordinatorId): Promise<IssueRead[]> {
  const issues = store.issues(coordinatorId);
  const agents = store.agents(coordinatorId);
  // why archived ones too: an ended agent's branch still names its issue's pull request.
  const threads = await threadsById(bb, agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])));
  const threadOf = (agent: Agent): ListedThread | null => (agent.threadId === null ? null : (threads.get(agent.threadId) ?? null));
  const openDecisions = new Set(store.decisions(coordinatorId).flatMap(({ issueId, answer }) => (issueId !== null && answer === null ? [issueId] : [])));

  const reads = await Promise.all(
    issues.map(async (issue) => {
      const own = agents.filter((agent) => agent.issueId === issue.id);
      const latest = own.at(-1) ?? null;
      const branch = issueBranch(own, threadOf)?.branch ?? null;
      const facts: IssueFacts = {
        issue,
        holder: await holderOf(bb, store, own, threadOf),
        left: leftBy(store, latest),
        pr: branch === null ? null : (store.prOfBranch(coordinatorId, branch)?.snapshot ?? null),
        openDecision: openDecisions.has(issue.id),
      };
      const live = latest === null ? null : threadOf(latest);
      return { facts, agent: latest, threadId: live !== null && isLive(live) ? live.id : null, branch };
    }),
  );
  const views = issueViews(reads.map(({ facts }) => facts));
  return reads.map(({ agent, threadId, branch }, i) => ({ view: viewAt(views, i), agent, threadId, branch }));
}

/** The issue's holder, its thread while bb runs it, and its current handoff, read only when its thread is idle. */
async function holderOf(bb: TurnsBb, store: FactsStore, own: readonly Agent[], threadOf: (agent: Agent) => ListedThread | null): Promise<IssueFacts["holder"]> {
  const agent = own.find(({ ended }) => ended === null);
  if (agent === undefined) return null;
  const listed = threadOf(agent);
  const thread = listed !== null && isLive(listed) ? listed : null;
  const current = thread?.status === "idle" ? await ifCurrent(bb, thread.id, store.latestHandoff(agent.coordinatorId, agent.id)) : null;
  return { agent, thread, current };
}

/** With no holder, the handoff its latest agent left as it ended (null: none). */
function leftBy(store: FactsStore, latest: Agent | null): IssueFacts["left"] {
  const left = latest?.ended?.left ?? null;
  return left === null ? null : store.handoff(left);
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

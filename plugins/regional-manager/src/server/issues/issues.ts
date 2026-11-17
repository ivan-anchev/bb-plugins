// What a regional manager does to its issues: file one, change its plan, its dependencies or where it
// rests, close it, and read it whole; and, for a close the manager didn't make, the announcement of
// what it unblocked. A status the manager writes is checked against the one derived from the facts
// (issue-facts.ts): it may rest an issue no agent holds, cancel one, or accept one In review, and
// nothing else; every other status is evidence.
import type { z } from "zod";
import type { Agent } from "../../model/agent.ts";
import { sameModel, type Execution, type RequestedExecution } from "../../model/execution.ts";
import { verifierProblem, type Issue, type IssueId, type managerStatusSchema } from "../../model/issue/issue.ts";
import { blockedBy, isClosed, newlyReady, relationsOf, unblockedBy, type Related } from "../../model/issue/relations.ts";
import { STATUS_LABELS, type IssueView } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { executionText } from "../agents/agents.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { DependencyChange, IssueEdit, NewIssue } from "../store/issue/issues-store.ts";
import type { Store } from "../store/store.ts";
import { readIssues, type FactsBb, type FactsStore, type IssueRead } from "./issue-facts.ts";
import { issueText, verifierText } from "./issue-text.ts";

/** The parts of bb the issues read: their agents' threads and turns, bb's catalog, and an agent's latest answer. */
type IssuesBb = FactsBb & CatalogBb & { sdk: { threads: { output(args: { threadId: string }): Promise<{ output: string | null }> } } };

type Deps = {
  bb: IssuesBb;
  store: FactsStore & Pick<Store, "issue" | "insertIssue" | "updateIssue" | "record" | "check" | "agent">;
  inbox: Pick<Inbox, "record">;
  /** Runs after anything that changes a regional manager's board. */
  onChange(id: CoordinatorId): void;
};

/** What issue_create files: a plan, with the verifier the manager names (left out: the plugin picks). */
type IssueRequest = Omit<NewIssue, "verifier"> & { verifier?: RequestedExecution };

/** What issue_update changes; a field left out stays. `verifier: null` gives the choice back to the plugin. */
type IssueChange = Partial<Pick<Issue, "kind" | "title" | "description" | "doneCriteria">> & {
  brief?: string;
  verifier?: RequestedExecution | null;
  status?: z.infer<typeof managerStatusSchema>;
  dependsOn?: DependencyChange;
};

type Refused = { refused: string };

export type Issues = ReturnType<typeof createIssues>;

export function createIssues({ bb, store, inbox, onChange }: Deps) {
  /**
   * The verifier named, resolved against bb's catalog on its primary machine. why there: where a
   * check runs is the agent's environment, not known yet; a verifier bb can't run there when the
   * check comes is passed over, and the verdict says so.
   */
  async function verifierOf(requested: RequestedExecution): Promise<Execution | Refused> {
    const resolved = await resolvedExecution(bb, {}, requested);
    return "refused" in resolved ? { refused: `On bb's primary machine: ${resolved.refused}` } : resolved;
  }

  const holderOf = (issue: Issue): Agent | null => store.agents(issue.coordinatorId).find((agent) => agent.issueId === issue.id && agent.ended === null) ?? null;

  const viewsOf = async (coordinatorId: CoordinatorId): Promise<IssueView[]> => (await readIssues(bb, store, coordinatorId)).map(({ view }) => view);

  /**
   * The edit a status asks for, or why the issue as it stands now (`view`, read just before) can't
   * take it. why the holder read after the view: an agent started meanwhile holds it (updateIssue
   * checks that again).
   */
  function statusEdit(issue: Issue, view: IssueView, status: NonNullable<IssueChange["status"]>): IssueEdit | Refused {
    const now = `${issue.id} is ${STATUS_LABELS[view.status]} (${view.headline})`;
    if (status === "done") return view.status === "in-review" ? { closed: { as: "accepted", at: Date.now() } } : { refused: `${now}, so it can't be marked Done: only an issue In review can.` };
    const holder = holderOf(issue);
    if (holder !== null) return { refused: `${holder.id} holds ${issue.id}, so it can't be ${status === "canceled" ? "canceled" : `moved to ${STATUS_LABELS[status]}`}. Stop ${holder.id} with agent_stop first.` };
    if (view.status === "done") return { refused: `${now}, and Done is final.` };
    return status === "canceled" ? { closed: { as: "canceled", at: Date.now() } } : { rest: status, closed: null };
  }

  return {
    /**
     * Files an issue, numbered after the regional manager's highest, with what blocks it as it is
     * filed; refused when its kind has no verifier, bb can't run the one named, or a dependency names
     * no issue. why the views read before the write, with no await between: an issue filed can't
     * change any other's status, and a failed read then files nothing.
     */
    async create(coordinatorId: CoordinatorId, { verifier: requested, ...plan }: IssueRequest): Promise<{ issue: Issue; blockedBy: Related[] } | Refused> {
      const problem = verifierProblem(plan.kind, requested !== undefined);
      if (problem !== null) return { refused: `No issue filed: ${problem}. Leave verifier out.` };
      const verifier = requested === undefined ? null : await verifierOf(requested);
      if (verifier !== null && "refused" in verifier) return { refused: `No issue filed. ${verifier.refused}` };
      const views = plan.dependsOn.length === 0 ? [] : await viewsOf(coordinatorId);
      const filed = store.insertIssue(coordinatorId, { ...plan, verifier }, Date.now());
      if ("refused" in filed) return { refused: `No issue filed: ${filed.refused}` };
      onChange(coordinatorId);
      return { issue: filed.issue, blockedBy: blockedBy(filed.issue, null, (id) => viewOf(views, id).status) };
    },

    /**
     * Applies the change, or says why it can't, changing nothing: a verifier bb can't run or that is
     * the model of the agent holding the issue, a status the issue as it stands can't take, or a
     * dependency on no issue, on itself, or closing a cycle. Returns the issue, what a verifier
     * change applies to, and the issues a status or dependency change made ready (a cancel or an
     * accept closes a dependency; a removed dependency may have been the last open one).
     */
    async update(issue: Issue, { verifier: requested, status, ...plan }: IssueChange): Promise<{ issue: Issue; note: string | null; nowReady: IssueId[] } | Refused> {
      // undefined: unchanged; null: the plugin picks.
      const verifier = requested === undefined || requested === null ? requested : await verifierOf(requested);
      if (verifier !== undefined && verifier !== null && "refused" in verifier) return verifier;
      const before = status === undefined && plan.dependsOn === undefined ? null : await viewsOf(issue.coordinatorId);
      const statusChange = before === null || status === undefined ? {} : statusEdit(issue, viewOf(before, issue.id), status);
      if ("refused" in statusChange) return statusChange;
      // why the holder read here, with no await before the write: an agent started meanwhile may run on the verifier's model.
      const holder = holderOf(issue);
      if (verifier !== undefined && verifier !== null && holder !== null && sameModel(verifier, holder.execution)) {
        return {
          refused: `${holder.id} holds ${issue.id} on ${executionText(holder.execution)}, so a verifier on it couldn't check that work independently. Name another model, or stop ${holder.id} with agent_stop and start an agent on another execution.`,
        };
      }
      const edit: IssueEdit = { ...plan, ...statusChange, ...(verifier === undefined ? {} : { verifier }) };
      const updated = store.updateIssue(issue.coordinatorId, issue.id, edit, { requireUnheld: status !== undefined && status !== "done" });
      if ("refused" in updated) return updated;
      onChange(issue.coordinatorId);
      const nowReady = before === null ? [] : newlyReady(before, await viewsOf(issue.coordinatorId));
      return { issue: updated.issue, note: requested === undefined ? null : verifierText(updated.issue), nowReady };
    },

    /** The issue whole, as issue_read returns it, with the issues it depends on and those that depend on it. */
    async read(issue: Issue): Promise<string> {
      const { coordinatorId, id } = issue;
      const reads = await readIssues(bb, store, coordinatorId);
      const read = readOf(reads, id);
      const agents = store.agents(coordinatorId).filter((agent) => agent.issueId === id);
      const output = read.threadId === null ? null : (await bb.sdk.threads.output({ threadId: read.threadId })).output;
      const views = reads.map(({ view }) => view);
      return issueText(read, relationsOf(views, read.view.issue), agents, store.record(coordinatorId, id), output, { agent: (agentId) => store.agent(coordinatorId, agentId) });
    },

    /**
     * Records `unblocked` for each open issue whose last open dependency was `closed`, judged from
     * the views read after the write that may have closed it, with no await before the records:
     * nothing when it isn't closed now (a merge on an earlier agent's branch, a report a message
     * already reopened). Called by whoever learns of a close the manager didn't make: the thread
     * watch when an agent's turn ends on a current handoff, the PR watch on a merge. why not inside
     * those writes: only status.ts can say whether an issue is closed. Two closes racing can announce
     * one issue twice: a repeated wake line, never a wrong status.
     */
    async announceUnblocked(coordinatorId: CoordinatorId, closed: IssueId): Promise<void> {
      if (!store.issues(coordinatorId).some(({ dependsOn }) => dependsOn.includes(closed))) return;
      const views = await viewsOf(coordinatorId);
      const { status } = viewOf(views, closed);
      if (!isClosed(status)) return;
      for (const issueId of unblockedBy(closed, views)) inbox.record(coordinatorId, { kind: "unblocked", issueId, by: closed, closedAs: status });
    },
  };
}

/** why throw: an id here names an issue of the same regional manager, and issues are never deleted. */
function viewOf(views: readonly IssueView[], id: IssueId): IssueView {
  const view = views.find(({ issue }) => issue.id === id);
  if (view === undefined) throw new Error(`The issue ${id} is missing.`);
  return view;
}

/** why throw: as viewOf. */
function readOf(reads: readonly IssueRead[], id: IssueId): IssueRead {
  const read = reads.find(({ view }) => view.issue.id === id);
  if (read === undefined) throw new Error(`The issue ${id} is missing.`);
  return read;
}

// What a regional manager does to its issues: file one, change its plan or where it rests, close it,
// and read it whole. A status the manager writes is checked against the one derived from the facts
// (issue-facts.ts): it may rest an issue no agent holds, cancel one, or accept one In review, and
// nothing else; every other status is evidence.
import type { z } from "zod";
import type { Agent } from "../../model/agent.ts";
import { sameModel, type Execution, type RequestedExecution } from "../../model/execution.ts";
import { verifierProblem, type Issue, type managerStatusSchema } from "../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { executionText } from "../agents/agents.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import type { IssueEdit, NewIssue } from "../store/issue/issues-store.ts";
import type { Store } from "../store/store.ts";
import { readIssue, type FactsBb, type FactsStore } from "./issue-facts.ts";
import { issueText, verifierText } from "./issue-text.ts";

/** The parts of bb the issues read: their agents' threads and turns, bb's catalog, and an agent's latest answer. */
type IssuesBb = FactsBb & CatalogBb & { sdk: { threads: { output(args: { threadId: string }): Promise<{ output: string | null }> } } };

type Deps = {
  bb: IssuesBb;
  store: FactsStore & Pick<Store, "issue" | "insertIssue" | "updateIssue" | "record" | "check" | "agent">;
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
};

type Refused = { refused: string };

export type Issues = ReturnType<typeof createIssues>;

export function createIssues({ bb, store, onChange }: Deps) {
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

  /**
   * The edit a status asks for, or why the issue as it stands now can't take it. why the holder
   * read after the view: an agent started meanwhile holds it (updateIssue checks that again).
   */
  async function statusEdit(issue: Issue, status: NonNullable<IssueChange["status"]>): Promise<IssueEdit | Refused> {
    const { view } = await readIssue(bb, store, issue);
    const now = `${issue.id} is ${STATUS_LABELS[view.status]} (${view.headline})`;
    if (status === "done") return view.status === "in-review" ? { closed: { as: "accepted", at: Date.now() } } : { refused: `${now}, so it can't be marked Done: only an issue In review can.` };
    const holder = holderOf(issue);
    if (holder !== null) return { refused: `${holder.id} holds ${issue.id}, so it can't be ${status === "canceled" ? "canceled" : `moved to ${STATUS_LABELS[status]}`}. Stop ${holder.id} with agent_stop first.` };
    if (view.status === "done") return { refused: `${now}, and Done is final.` };
    return status === "canceled" ? { closed: { as: "canceled", at: Date.now() } } : { rest: status, closed: null };
  }

  return {
    /** Files an issue, numbered after the regional manager's highest; refused when its kind has no verifier or bb can't run the one named. */
    async create(coordinatorId: CoordinatorId, { verifier: requested, ...plan }: IssueRequest): Promise<Issue | Refused> {
      const problem = verifierProblem(plan.kind, requested !== undefined);
      if (problem !== null) return { refused: `No issue filed: ${problem}. Leave verifier out.` };
      const verifier = requested === undefined ? null : await verifierOf(requested);
      if (verifier !== null && "refused" in verifier) return { refused: `No issue filed. ${verifier.refused}` };
      const issue = store.insertIssue(coordinatorId, { ...plan, verifier }, Date.now());
      onChange(coordinatorId);
      return issue;
    },

    /**
     * Applies the change, or says why it can't, changing nothing: a verifier bb can't run or that is
     * the model of the agent holding the issue, or a status the issue as it stands can't take.
     * Returns the issue, and what a verifier change applies to.
     */
    async update(issue: Issue, { verifier: requested, status, ...plan }: IssueChange): Promise<{ issue: Issue; note: string | null } | Refused> {
      // undefined: unchanged; null: the plugin picks.
      const verifier = requested === undefined || requested === null ? requested : await verifierOf(requested);
      if (verifier !== undefined && verifier !== null && "refused" in verifier) return verifier;
      const statusChange = status === undefined ? {} : await statusEdit(issue, status);
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
      return { issue: updated.issue, note: requested === undefined ? null : verifierText(updated.issue) };
    },

    /** The issue whole, as issue_read returns it. */
    async read(issue: Issue): Promise<string> {
      const { coordinatorId, id } = issue;
      const read = await readIssue(bb, store, issue);
      const agents = store.agents(coordinatorId).filter((agent) => agent.issueId === id);
      const output = read.threadId === null ? null : (await bb.sdk.threads.output({ threadId: read.threadId })).output;
      return issueText(read, agents, store.record(coordinatorId, id), output, { agent: (agentId) => store.agent(coordinatorId, agentId) });
    },
  };
}

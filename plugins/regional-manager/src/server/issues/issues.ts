import type { z } from "zod";
import type { Agent } from "../../model/agent.ts";
import { sameModel, type Execution, type RequestedExecution } from "../../model/execution.ts";
import { verifierProblem, type Issue, type IssueId, type managerStatusSchema } from "../../model/issue/issue.ts";
import { blockedBy, closesOf, newlyReady, relationsOf, type Related } from "../../model/issue/relations.ts";
import { headlineText, STATUS_LABELS, type IssueView } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { executionText } from "../agents/agents.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import type { DependencyChange, IssueEdit, NewIssue } from "../store/issue/issues-store.ts";
import type { Store } from "../store/store.ts";
import type { CurrentViews } from "./views/current-views.ts";
import { readIssues, type FactsBb, type FactsStore, type IssueRead } from "./views/issue-facts.ts";
import { issueText, verifierText } from "./issue-text.ts";

/** The parts of bb the issues read: their agents' threads and turns, bb's catalog, and an agent's latest answer. */
type IssuesBb = FactsBb & CatalogBb & { sdk: { threads: { output(args: { threadId: string }): Promise<{ output: string | null }> } } };

type Deps = {
  bb: IssuesBb;
  store: FactsStore & Pick<Store, "issue" | "insertIssue" | "updateIssue" | "record" | "check" | "agent" | "finalChecks" | "issueDecisions">;
  views: Pick<CurrentViews, "whileCurrent">;
  /** Runs after anything that changes a regional manager's board. */
  onChange(id: CoordinatorId): void;
};

type IssueRequest = Omit<NewIssue, "verifier"> & { verifier?: RequestedExecution };

type IssueChange = Partial<Pick<Issue, "kind" | "title" | "description" | "doneCriteria" | "parentId">> & {
  brief?: string;
  decision?: string;
  verifier?: RequestedExecution | null;
  status?: z.infer<typeof managerStatusSchema>;
  dependsOn?: DependencyChange;
};

type Refused = { refused: string };

const OVERTAKEN = "your issues kept changing while they were read, so nothing was written. Try again.";

export type Issues = ReturnType<typeof createIssues>;

export function createIssues({ bb, store, views: current, onChange }: Deps) {
  async function verifierOf(requested: RequestedExecution): Promise<Execution | Refused> {
    const resolved = await resolvedExecution(bb, {}, requested);
    return "refused" in resolved ? { refused: `On bb's primary machine: ${resolved.refused}` } : resolved;
  }

  const holderOf = (issue: Issue): Agent | null => store.agents(issue.coordinatorId).find((agent) => agent.issueId === issue.id && agent.ended === null) ?? null;

  const viewsOf = async (coordinatorId: CoordinatorId): Promise<IssueView[]> => (await readIssues(bb, store, coordinatorId)).map(({ view }) => view);

  function statusEdit(issue: Issue, view: IssueView, status: NonNullable<IssueChange["status"]>): IssueEdit | Refused {
    const now = `${issue.id} is ${STATUS_LABELS[view.status]} (${headlineText(view)})`;
    if (status === "done") return view.status === "in-review" ? { closed: { as: "accepted", at: Date.now() } } : { refused: `${now}, so it can't be marked Done: only an issue In review can.` };
    const holder = holderOf(issue);
    if (holder !== null) return { refused: `${holder.id} holds ${issue.id}, so it can't be ${status === "canceled" ? "canceled" : `moved to ${STATUS_LABELS[status]}`}. Stop ${holder.id} with agent_stop first.` };
    if (view.status === "done") return { refused: `${now}, and Done is final.` };
    return status === "canceled" ? { closed: { as: "canceled", at: Date.now() } } : { rest: status, closed: null };
  }

  return {
    async create(coordinatorId: CoordinatorId, { verifier: requested, ...plan }: IssueRequest): Promise<{ issue: Issue; blockedBy: Related[] } | Refused> {
      const problem = verifierProblem(plan.kind, requested !== undefined);
      if (problem !== null) return { refused: `No issue filed: ${problem}. Leave verifier out.` };
      const verifier = requested === undefined ? null : await verifierOf(requested);
      if (verifier !== null && "refused" in verifier) return { refused: `No issue filed. ${verifier.refused}` };
      const file = (views: IssueView[]) => ({ filed: store.insertIssue(coordinatorId, { ...plan, verifier }, closesOf(views), Date.now()), views });
      const written = plan.dependsOn.length === 0 && plan.parentId === null ? { acted: file([]) } : await current.whileCurrent(coordinatorId, file);
      if (written === null) return { refused: `No issue filed: ${OVERTAKEN}` };
      const { filed, views } = written.acted;
      if ("refused" in filed) return { refused: `No issue filed: ${filed.refused}` };
      onChange(coordinatorId);
      const parent = plan.parentId === null ? null : viewOf(views, plan.parentId).issue;
      return { issue: filed.issue, blockedBy: blockedBy(filed.issue, parent, (id) => viewOf(views, id).status) };
    },

    async update(issue: Issue, { verifier: requested, status, dependsOn, decision, ...plan }: IssueChange): Promise<{ issue: Issue; note: string | null; nowReady: IssueId[] } | Refused> {
      const verifier = requested === undefined || requested === null ? requested : await verifierOf(requested);
      if (verifier !== undefined && verifier !== null && "refused" in verifier) return verifier;
      const write = (before: IssueView[] | null): { issue: Issue; before: IssueView[] | null } | Refused => {
        const statusChange = before === null || status === undefined ? {} : statusEdit(issue, viewOf(before, issue.id), status);
        if ("refused" in statusChange) return statusChange;
        const holder = holderOf(issue);
        if (verifier !== undefined && verifier !== null && holder !== null && sameModel(verifier, holder.execution)) {
          return {
            refused: `${holder.id} holds ${issue.id} on ${executionText(holder.execution)}, so a verifier on it couldn't check that work independently. Name another model, or stop ${holder.id} with agent_stop and start an agent on another execution.`,
          };
        }
        const edit: IssueEdit = {
          ...plan,
          ...statusChange,
          ...(dependsOn === undefined ? {} : { dependsOn }),
          ...(verifier === undefined ? {} : { verifier }),
          ...(decision === undefined ? {} : { decision: { text: decision, at: Date.now() } }),
        };
        const updated = store.updateIssue(issue.coordinatorId, issue.id, edit, { requireUnheld: status !== undefined && status !== "done", closes: closesOf(before ?? []) });
        return "refused" in updated ? updated : { issue: updated.issue, before };
      };
      const written = status === undefined && dependsOn === undefined && plan.parentId === undefined ? { acted: write(null) } : await current.whileCurrent(issue.coordinatorId, write);
      if (written === null) return { refused: `${issue.id} is unchanged: ${OVERTAKEN}` };
      if ("refused" in written.acted) return written.acted;
      const { issue: updated, before } = written.acted;
      onChange(issue.coordinatorId);
      const nowReady = before === null ? [] : newlyReady(before, await viewsOf(issue.coordinatorId));
      return { issue: updated, note: requested === undefined ? null : verifierText(updated), nowReady };
    },

    async read(issue: Issue): Promise<string> {
      const { coordinatorId, id } = issue;
      const reads = await readIssues(bb, store, coordinatorId);
      const read = readOf(reads, id);
      const agents = store.agents(coordinatorId).filter((agent) => agent.issueId === id);
      const output = read.threadId === null ? null : (await bb.sdk.threads.output({ threadId: read.threadId })).output;
      const views = reads.map(({ view }) => view);
      const record = { handed: store.record(coordinatorId, id), finalChecks: store.finalChecks(coordinatorId, id) };
      return issueText(read, relationsOf(views, read.view.issue), agents, record, store.issueDecisions(coordinatorId, id), output, { agents: () => store.agents(coordinatorId) });
    },
  };
}

function viewOf(views: readonly IssueView[], id: IssueId): IssueView {
  const view = views.find(({ issue }) => issue.id === id);
  if (view === undefined) throw new Error(`The issue ${id} is missing.`);
  return view;
}

function readOf(reads: readonly IssueRead[], id: IssueId): IssueRead {
  const read = reads.find(({ view }) => view.issue.id === id);
  if (read === undefined) throw new Error(`The issue ${id} is missing.`);
  return read;
}

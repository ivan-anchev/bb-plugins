// What a regional manager does to its issues: file one, change its plan, its dependencies or where it
// rests, close it, and read it whole. A status the manager writes is checked against the one derived
// from the facts (issue-facts.ts): it may rest an issue no agent holds, cancel one, or accept one In
// review, and nothing else; every other status is evidence.
import type { z } from "zod";
import type { Agent } from "../../model/agent/agent.ts";
import { sameModel, type Execution, type RequestedExecution } from "../../model/agent/execution.ts";
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
type IssuesBb = FactsBb & CatalogBb & { pluginId: string; sdk: { threads: { output(args: { threadId: string }): Promise<{ output: string | null }> } } };

type Deps = {
  bb: IssuesBb;
  store: FactsStore & Pick<Store, "issue" | "insertIssue" | "updateIssue" | "record" | "check" | "agent" | "finalChecks" | "issueDecisions" | "commentsOf">;
  views: Pick<CurrentViews, "whileCurrent">;
  /** Runs after anything that changes a regional manager's board. */
  onChange(id: CoordinatorId): void;
};

/** What issue_create files: a plan, with the verifier the manager names (left out: the plugin picks). */
type IssueRequest = Omit<NewIssue, "verifier"> & { verifier?: RequestedExecution };

/**
 * What issue_update changes; a field left out stays. `verifier: null` gives the choice back to the plugin; `parentId: null` makes it
 * top-level. `decision`: what was decided and why, recorded among its decisions as of now.
 */
type IssueChange = Partial<Pick<Issue, "kind" | "title" | "description" | "doneCriteria" | "parentId">> & {
  brief?: string;
  decision?: string;
  verifier?: RequestedExecution | null;
  status?: z.infer<typeof managerStatusSchema>;
  dependsOn?: DependencyChange;
};

type Refused = { refused: string };

/** Why a write judged on every issue viewed made none: changes kept coming while they were read. */
const OVERTAKEN = "your issues kept changing while they were read, so nothing was written. Try again.";

export type Issues = ReturnType<typeof createIssues>;

export function createIssues({ bb, store, views: current, onChange }: Deps) {
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
   * The edit a status asks for, or why the issue as it stands now (`view`, current as the edit is
   * written) can't take it. why the holder read after the view: an agent started meanwhile holds it
   * (updateIssue checks that again). A parent's open sub-issues are the plan's to refuse (plan.ts).
   * A close is at `at`; a canceled issue canceled again keeps its close.
   */
  function statusEdit(issue: Issue, view: IssueView, status: NonNullable<IssueChange["status"]>, at: number): IssueEdit | Refused {
    const now = `${issue.id} is ${STATUS_LABELS[view.status]} (${headlineText(view)})`;
    if (status === "done") return view.status === "in-review" ? { closed: { as: "accepted", at } } : { refused: `${now}, so it can't be marked Done: only an issue In review can.` };
    const holder = holderOf(issue);
    if (holder !== null) return { refused: `${holder.id} holds ${issue.id}, so it can't be ${status === "canceled" ? "canceled" : `moved to ${STATUS_LABELS[status]}`}. Stop ${holder.id} with agent_stop first.` };
    if (view.status === "done") return { refused: `${now}, and Done is final.` };
    if (status !== "canceled") return { rest: status, closed: null };
    // why the closure kept: canceling a canceled issue again, as a retried call, changes nothing, its time included.
    return { closed: view.issue.closed?.as === "canceled" ? view.issue.closed : { as: "canceled", at } };
  }

  return {
    /**
     * Files an issue, numbered after the regional manager's highest, with what blocks it as it is
     * filed; refused when its kind has no verifier, bb can't run the one named, or the plan with it
     * can't stand (plan.ts). why on views current as it is written (current-views.ts): a parent
     * closed by its work, or a dependency's close, can change while bb is read, and filing a
     * sub-issue changes its parent's status. Its dependencies are written, and its parent judged
     * open, from what those views say, which is what the manager is told; a failed read files nothing.
     */
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

    /**
     * Applies the change, or says why it can't, changing nothing: a verifier bb can't run or that is
     * the model of the agent holding the issue, a status the issue as it stands can't take, or a
     * plan that can't stand (plan.ts). Returns the issue, what a verifier change applies to, and the
     * issues a status, parent or dependency change made ready (a cancel or an accept closes a
     * dependency; a removed dependency may have been the last open one, a parent left the last
     * blocking one).
     */
    async update(issue: Issue, { verifier: requested, status, dependsOn, decision, ...plan }: IssueChange): Promise<{ issue: Issue; note: string | null; nowReady: IssueId[] } | Refused> {
      // undefined: unchanged; null: the plugin picks.
      const verifier = requested === undefined || requested === null ? requested : await verifierOf(requested);
      if (verifier !== undefined && verifier !== null && "refused" in verifier) return verifier;
      /** Writes the change judged on `before`: every issue viewed, or null when nothing changed is judged by them. */
      const write = (before: IssueView[] | null): { issue: Issue; before: IssueView[] | null } | Refused => {
        // why one moment: a close, a decision and the log of what changed tell one edit.
        const at = Date.now();
        const statusChange = before === null || status === undefined ? {} : statusEdit(issue, viewOf(before, issue.id), status, at);
        if ("refused" in statusChange) return statusChange;
        // why the holder read here, with no await before the write: an agent started meanwhile may run on the verifier's model.
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
          ...(decision === undefined ? {} : { decision: { text: decision, at } }),
        };
        const updated = store.updateIssue(issue.coordinatorId, issue.id, edit, { requireUnheld: status !== undefined && status !== "done", closes: closesOf(before ?? []), at });
        return "refused" in updated ? updated : { issue: updated.issue, before };
      };
      // why views current as it is written (current-views.ts), whenever a status, parent or dependency changes: the only changes judged by them.
      const written = status === undefined && dependsOn === undefined && plan.parentId === undefined ? { acted: write(null) } : await current.whileCurrent(issue.coordinatorId, write);
      if (written === null) return { refused: `${issue.id} is unchanged: ${OVERTAKEN}` };
      if ("refused" in written.acted) return written.acted;
      const { issue: updated, before } = written.acted;
      onChange(issue.coordinatorId);
      const nowReady = before === null ? [] : newlyReady(before, await viewsOf(issue.coordinatorId));
      return { issue: updated, note: requested === undefined ? null : verifierText(updated), nowReady };
    },

    /** The issue whole, as issue_read returns it, with the issues it depends on and those that depend on it, and its decisions. */
    async read(issue: Issue): Promise<string> {
      const { coordinatorId, id } = issue;
      const reads = await readIssues(bb, store, coordinatorId);
      const read = readOf(reads, id);
      const agents = store.agents(coordinatorId).filter((agent) => agent.issueId === id);
      const output = read.threadId === null ? null : (await bb.sdk.threads.output({ threadId: read.threadId })).output;
      const views = reads.map(({ view }) => view);
      const record = { handed: read.record, finalChecks: store.finalChecks(coordinatorId, id) };
      return issueText(read, relationsOf(views, read.view.issue), agents, record, store.issueDecisions(coordinatorId, id), store.commentsOf(coordinatorId, id), output, { agents: () => store.agents(coordinatorId) }, bb.pluginId);
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

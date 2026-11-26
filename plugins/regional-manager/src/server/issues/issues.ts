// What a regional manager does to its issues: file one, change its plan, its dependencies or where it
// rests, close it, and read it whole. A status the manager writes is checked against the one derived
// from the facts (issue-facts.ts): it may rest an issue no agent holds, cancel one, accept one In
// review as Done, or accept a failure on review findings alone into In review, and nothing else;
// every other status is evidence.
import type { z } from "zod";
import type { Agent, AgentId } from "../../model/agent/agent.ts";
import { sameModel, type Execution, type RequestedExecution } from "../../model/agent/execution.ts";
import { verifierProblem, type Issue, type IssueId, type managerStatusSchema, type NewIssue } from "../../model/issue/issue.ts";
import { blockedBy, closesOf, newlyReady, relationsOf, type Related } from "../../model/issue/relations.ts";
import { headlineText, latestChecked, STATUS_LABELS, type IssueView } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Check, CheckId } from "../../model/verdict/check.ts";
import { prRef } from "../../model/verdict/pr.ts";
import { capMovesText } from "../../model/verdict/rounds/cap.ts";
import { checkedPr, ciFailedAt, failedOnReviewOnly, type PrOfBranch, failurePhrases, failureReasons, outcome, type Outcome } from "../../model/verdict/verdict.ts";
import { executionText } from "../agents/agents.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import type { DependencyChange, IssueEdit } from "../store/issue/issues-store.ts";
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

/** What an accept into In review did: the follow-up it filed, and the agent that still holds the issue (null: none). */
export type Accepted = { followUpId: IssueId; holder: AgentId | null };

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

  /** The follow-up an accepted check filed, as its row names it. why throw: an accept files one in the transaction that stamps it (issues-store.ts updateIssue). */
  function followUpOf(checkId: CheckId): IssueId {
    const followUpId = store.check(checkId)?.followUpId ?? null;
    if (followUpId === null) throw new Error(`The accepted check ${checkId} filed no follow-up.`);
    return followUpId;
  }

  const holderOf = (issue: Issue): Agent | null => store.agents(issue.coordinatorId).find((agent) => agent.issueId === issue.id && agent.ended === null) ?? null;

  const viewsOf = async (coordinatorId: CoordinatorId): Promise<IssueView[]> => (await readIssues(bb, store, coordinatorId)).map(({ view }) => view);

  /**
   * The edit a status asks for, or why the issue as it stands now (`view`, current as the edit is
   * written) can't take it. why the holder read after the view: an agent started meanwhile holds it
   * (updateIssue checks that again). A parent's open sub-issues are the plan's to refuse (plan.ts).
   * A close is at `at`; a canceled issue canceled again keeps its close.
   */
  function statusEdit(issue: Issue, view: IssueView, status: NonNullable<IssueChange["status"]>, decision: string | undefined, at: number): IssueEdit | Refused {
    const now = `${issue.id} is ${STATUS_LABELS[view.status]} (${headlineText(view)})`;
    if (status === "done") return doneEdit(view, now, at);
    if (status === "in-review") return acceptEdit(view, decision);
    const holder = holderOf(issue);
    if (holder !== null) return { refused: `${holder.id} holds ${issue.id}, so it can't be ${status === "canceled" ? "canceled" : `moved to ${STATUS_LABELS[status]}`}. Stop ${holder.id} with agent_stop first.` };
    if (view.status === "done") return { refused: `${now}, and Done is final.` };
    if (status !== "canceled") return { rest: status, closed: null };
    // why the closure kept: canceling a canceled issue again, as a retried call, changes nothing, its time included.
    return { closed: view.issue.closed?.as === "canceled" ? view.issue.closed : { as: "canceled", at } };
  }

  /**
   * The edit that accepts the issue's failure as it is, into In review, or why it can't be: it needs
   * a decision saying why, an open issue, no cap question of it still open (the user's call there,
   * rounds/cap.ts), and a latest verdict that failed on review findings alone (verdict.ts
   * failedOnReviewOnly), not yet accepted, on a commit CI didn't fail on as its pull request was
   * last read. why the issue's record, never `view.placing`: no check places the issue while its
   * agent's thread works, nor the one its ended agent didn't leave. updateIssue checks again that
   * the check is still the latest as it writes.
   */
  function acceptEdit(view: IssueView, decision: string | undefined): IssueEdit | Refused {
    const { id } = view.issue;
    if (decision === undefined) return { refused: `${id} wasn't accepted: an accept into In review needs a decision saying why its work is accepted as it is. Send status "in-review" again with decision.` };
    const closed = closedRefusal(view);
    if (closed !== null) return { refused: closed };
    if (view.capLock !== null) {
      const { cap, id: question } = view.capLock;
      return { refused: `${id} failed verification ${cap} times, so the plugin asked the user (${question}), and until they answer, accepting it is theirs to decide there. Once they answer, accept it if that is their call. ${capMovesText(id, question, view)}` };
    }
    const latest = latestChecked(store.record(view.issue.coordinatorId, id));
    if (latest === null) return { refused: `${id} has no done handoff with a verdict, so there is no failure to accept.` };
    const problem = acceptProblem(latest.check, id, (branch) => store.prOfBranch(view.issue.coordinatorId, branch)?.snapshot ?? null);
    return problem === null ? { accept: latest.check.id } : { refused: problem };
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
     * plan that can't stand (plan.ts). Returns the issue, what a verifier change applies to, the
     * issues a status, parent or dependency change made ready (a cancel or an accept as Done closes
     * a dependency; a removed dependency may have been the last open one, a parent left the last
     * blocking one), and what an accept into In review did (null: none was made).
     */
    async update(issue: Issue, { verifier: requested, status, dependsOn, decision, ...plan }: IssueChange): Promise<{ issue: Issue; note: string | null; nowReady: IssueId[]; accepted: Accepted | null } | Refused> {
      // undefined: unchanged; null: the plugin picks.
      const verifier = requested === undefined || requested === null ? requested : await verifierOf(requested);
      if (verifier !== undefined && verifier !== null && "refused" in verifier) return verifier;
      /** Writes the change judged on `before`: every issue viewed, or null when nothing changed is judged by them. */
      const write = (before: IssueView[] | null): { issue: Issue; before: IssueView[] | null; accepted: Accepted | null } | Refused => {
        // why one moment: a close, a decision and the log of what changed tell one edit.
        const at = Date.now();
        const statusChange = before === null || status === undefined ? {} : statusEdit(issue, viewOf(before, issue.id), status, decision, at);
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
        // why an accept may leave its agent holding the issue: it may still be working, and the manager is told to stop it (issue-text.ts updatedText).
        const updated = store.updateIssue(issue.coordinatorId, issue.id, edit, { requireUnheld: status !== undefined && status !== "done" && status !== "in-review", closes: closesOf(before ?? []), at });
        if ("refused" in updated) return updated;
        return { issue: updated.issue, before, accepted: edit.accept === undefined ? null : { followUpId: followUpOf(edit.accept), holder: holder?.id ?? null } };
      };
      // why views current as it is written (current-views.ts), whenever a status, parent or dependency changes: the only changes judged by them.
      const written = status === undefined && dependsOn === undefined && plan.parentId === undefined ? { acted: write(null) } : await current.whileCurrent(issue.coordinatorId, write);
      if (written === null) return { refused: `${issue.id} is unchanged: ${OVERTAKEN}` };
      if ("refused" in written.acted) return written.acted;
      const { issue: updated, before, accepted } = written.acted;
      onChange(issue.coordinatorId);
      const nowReady = before === null ? [] : newlyReady(before, await viewsOf(issue.coordinatorId));
      return { issue: updated, note: requested === undefined ? null : verifierText(updated), nowReady, accepted };
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

/**
 * Why the issue's latest check can't be accepted as it is, leading with the reason, then the moves
 * that work; null when it can: its verdict failed on review findings alone, it isn't accepted yet,
 * and CI didn't fail on its commit as its work's pull request was last read (verdict.ts checkedPr).
 */
function acceptProblem(latest: Check, id: IssueId, prOf: PrOfBranch): string | null {
  const { verdict, subject, acceptedAt } = latest;
  if (acceptedAt !== null) return `${id}'s latest verdict was accepted already, so nothing changed.`;
  const result = outcome(verdict);
  if (result === "pending" || result === "waiting-for-ci") return `${id}'s latest done handoff is still being checked, so there is no failed verdict to accept yet. Wait for its verdict, which crew_catch_up brings you.`;
  if (result !== "fail") return `${id}'s latest verdict didn't fail (${OUTCOME_WORDS[result]}), so there is no failure on review findings to accept.`;
  // why throw: only a returned verdict fails (verdict.ts outcome).
  if (verdict.state !== "returned") throw new Error(`${id}'s failed verdict hasn't returned.`);
  if (!failedOnReviewOnly(verdict)) return `${id}'s latest verdict failed on more than review findings (${notReviewOnly(verdict)}), so it can't be accepted as it is: only a failure on review findings alone can. ${FIX_IT}`;
  const pr = checkedPr(subject, prOf);
  return pr !== null && ciFailedAt(subject, pr) ? `CI failed on ${prRef(pr)} at ${verdict.headSha.slice(0, 7)}, the commit ${id}'s latest verdict checked, so it can't be accepted as it is. ${FIX_IT}` : null;
}

/** Why a verdict that failed didn't fail on review findings alone: its reasons besides those findings, in the order every surface reads them. */
function notReviewOnly(verdict: Extract<Check["verdict"], { state: "returned" }>): string {
  const reasons = failureReasons(verdict).filter(({ kind }) => kind !== "must-fix");
  const criteria = reasons.flatMap((reason) => (reason.kind === "criteria" ? [`${reason.failed} of ${reason.of} criteria didn't pass`] : []));
  return [...failurePhrases(reasons, "handoff"), ...criteria].join("; ");
}

/** What a verdict that didn't fail says, as an accept's refusal words it. */
const OUTCOME_WORDS: Record<Exclude<Outcome, "fail" | "pending" | "waiting-for-ci">, string> = {
  pass: "it passed",
  unverified: "it was made with verification off",
  "could-not-run": "it couldn't be had",
  superseded: "a newer handoff replaced it",
};

/** The moves left on a failure that isn't the manager's to accept. */
const FIX_IT = "Message its agent with agent_message, stop it and start a fresh agent on the issue with agent_start, or ask the user.";

/**
 * The manager's close of an issue In review as Done (`now`: where it stands, in words), or why it
 * can't be: only an issue In review is, and never one whose failure the manager accepted as it is,
 * which stays open until its pull request merges.
 */
function doneEdit(view: IssueView, now: string, at: number): IssueEdit | Refused {
  if (view.status !== "in-review") return { refused: `${now}, so it can't be marked Done: only an issue In review can.` };
  if (view.placing !== null && view.placing.acceptedAt !== null) {
    return { refused: `${now}: it was accepted as it is, so it stays In review, its pull request watched and what depends on it blocked, until that pull request merges, which makes it Done. Wait for the merge; it is never marked Done before.` };
  }
  return { closed: { as: "accepted", at } };
}

/** Why a closed issue (`view`) can't be accepted into In review; null while it is open. */
function closedRefusal(view: IssueView): string | null {
  const now = `${view.issue.id} is ${STATUS_LABELS[view.status]} (${headlineText(view)})`;
  if (view.status === "done") return `${now}, and Done is final, so there is nothing to accept.`;
  return view.status === "canceled" ? `${now}, so it can't be accepted. Reopen it with status "todo" first if its work is wanted, then accept it.` : null;
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

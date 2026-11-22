// Where an issue stands, why, whether it waits on the user, and what blocks it: derived from its
// stored plan and the facts beside it, never stored. Pure, so the board, crew_catch_up, issue_read,
// the rail badge, the PR watch, the final checks' pass and the unblocked announcements share one definition. The kind enters in one place: a done handoff walks its
// kind's stages (walk); everything that reads an IssueStatus never sees a kind.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Agent, EndedHow } from "../agent.ts";
import type { Handoff, HandoffId } from "../handoff.ts";
import type { Check, CheckId, FinalCheck } from "../verdict/check.ts";
import type { CiVerdict, PrSnapshot } from "../verdict/pr.ts";
import { NOT_CLEAN } from "../verdict/checkout.ts";
import { isReviewing } from "../verdict/review.ts";
import { allPassed, ciVerdictOf, failedCheckout, mayHaveReachedAgent, outcome, type Verdict } from "../verdict/verdict.ts";
import type { Issue, IssueId } from "./issue.ts";
import { isVerified, PIPELINES, shipsCode, type Kind, type Stage } from "./kind.ts";
import { blockedBy, isClosed, statusIn, type Related } from "./relations.ts";

export const issueStatusSchema = z.enum(["backlog", "todo", "in-progress", "reviewing", "verifying", "in-review", "done", "canceled"]);
export type IssueStatus = z.infer<typeof issueStatusSchema>;

/** Each status's name, as the board and crew_catch_up show it. */
export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In progress",
  reviewing: "Reviewing",
  verifying: "Verifying",
  "in-review": "In review",
  done: "Done",
  canceled: "Canceled",
};

type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

/** The holding agent's thread as bb lists it now. */
export type HolderThread = Pick<ThreadRow, "status" | "hasPendingInteraction">;

/** A handoff and the check made of it (null: none was). */
export type Handed = { handoff: Handoff; check: Check | null };

/** Everything one issue's view is derived from. Nothing here reads bb or SQLite. */
export type IssueFacts = {
  issue: Issue;
  /** The agent holding it now; its thread (null: bb no longer lists it); its current handoff (handoffIsCurrent), null when it has none. */
  holder: { agent: Agent; thread: HolderThread | null; current: Handed | null } | null;
  /** With no holder: how its latest agent ended, and the handoff it left then (null: none); null when no agent ever started on it. */
  ended: { how: EndedHow; left: Handed | null } | null;
  /** The pull request of its branch (agent.ts issueBranch) as last read (null: none seen). */
  pr: PrSnapshot | null;
  /** An unanswered decision names it. */
  openDecision: boolean;
  /** Its latest final check (null: none was made, as for every issue but a build parent whose work was all merged). */
  finalCheck: FinalCheck | null;
  /** The verifier of one of its running checks waits on an answer or an approval in its thread, which the plugin declines (verify.ts watchRunning). */
  verifierAsks: boolean;
};

export type IssueView = {
  issue: Issue;
  status: IssueStatus;
  /** Why it waits on the user, or null. A flag on an open issue, never a status. */
  needsYou: string | null;
  /** What it is doing or why it rests, in a line; for a parent, only what its count of Done sub-issues doesn't say (null: nothing). */
  headline: string | null;
  holder: Agent | null;
  /** The check whose verdict places it (the board's verdict), or null. */
  placing: Check | null;
  pr: PrSnapshot | null;
  /** The open issues it or its parent depends on, each with its status; none once it is closed itself. Derived from the other views, never stored. */
  blockedBy: Related[];
  /** The open issues that depend on it, each with its status; none once it is closed itself, since a closed issue blocks nothing. Derived as blockedBy is. */
  blocks: Related[];
  /** A parent's sub-issues: how many are Done, of how many; null for an issue with none. */
  subIssues: { done: number; total: number } | null;
  /** What closed it (null: it is open). */
  closedBy: Closure | null;
  /** A build parent whose final check is due: its Done build sub-issues, whose merged work the check judges. Null when none is due. */
  finalCheckDue: IssueId[] | null;
};

/**
 * What closed an issue, the one place that says why it is closed: the manager's act, its pull
 * request merged, the handoff that made it Done, for a parent the close of each of its sub-issues,
 * or for a build parent the final check that passed. A research issue reopened and reported again
 * is closed by another handoff; a build parent whose fix was checked again, by another final check.
 */
export type Closure =
  | { by: "manager"; as: NonNullable<Issue["closed"]>["as"] }
  | { by: "merge"; number: number }
  | { by: "handoff"; handoffId: HandoffId }
  | { by: "sub-issues"; closes: Closure[] }
  | { by: "final-check"; checkId: CheckId };

/** A view before its dependencies are read: where its own facts, or its sub-issues, place it. */
type Placed = Omit<IssueView, "blockedBy" | "blocks">;

type Placing = Pick<IssueView, "status" | "headline" | "needsYou">;

/**
 * Every issue of one regional manager, viewed: each leaf placed by its own facts, then each parent
 * by its sub-issues so placed, then every issue blocked by, and blocking, by the statuses so placed.
 * why from the same views: what blocks an issue can never disagree with the status shown for its
 * dependency, nor what it blocks with its dependents'.
 */
export function issueViews(all: readonly IssueFacts[]): IssueView[] {
  const leaves = all.map(issueView);
  const subIssuesOf = (id: IssueId): Placed[] => leaves.filter(({ issue }) => issue.parentId === id);
  const placed = all.map((facts, i) => {
    const subIssues = subIssuesOf(facts.issue.id);
    return subIssues.length === 0 ? at(leaves, i) : parentView(facts, subIssues);
  });
  const statuses = new Map(placed.map(({ issue, status }) => [issue.id, status]));
  const issues = new Map(all.map(({ issue }) => [issue.id, issue]));
  return placed.map((view) => {
    if (isClosed(view.status)) return { ...view, blockedBy: [], blocks: [] };
    const parent = view.issue.parentId === null ? null : (issues.get(view.issue.parentId) ?? null);
    return { ...view, blockedBy: blockedBy(view.issue, parent, (id) => statusIn(statuses, id)), blocks: openDependents(placed, view.issue.id) };
  });
}

/** The open issues that depend on `id` themselves, in the order filed. why not through a parent: a parent's dependent is the parent, as issue_read's relations name it. */
const openDependents = (placed: readonly Placed[], id: IssueId): Related[] =>
  placed.filter(({ issue, status }) => issue.dependsOn.includes(id) && !isClosed(status)).map(({ issue, status }) => ({ id: issue.id, status }));

const ASKED = "Waiting on your answer to its decision";

/** How the manager's two closing acts place an issue. */
const CLOSED = { canceled: { status: "canceled", headline: "Canceled" }, accepted: { status: "done", headline: "Accepted" } } as const;

function issueView({ issue, holder, ended, pr, openDecision, verifierAsks }: IssueFacts): Placed {
  const base = { issue, holder: holder?.agent ?? null, pr, placing: null, subIssues: null, finalCheckDue: null };
  const final = finalOf(issue, pr);
  if (final !== null) return { ...base, ...final, needsYou: null };
  const asked = openDecision ? ASKED : null;
  if (holder !== null) {
    const placed = held(issue.kind, holder, { pr, verifierAsks });
    return { ...base, ...placed, needsYou: placed.needsYou ?? asked, closedBy: handedOffClose(placed, holder.current) };
  }
  const left = ended?.left ?? null;
  const after = left === null ? null : placedByLeft(issue.kind, left, { pr, verifierAsks });
  if (left !== null && after !== null) return { ...base, ...after, placing: left.check, needsYou: after.needsYou ?? asked, closedBy: handedOffClose(after, left) };
  return { ...base, status: issue.rest, headline: restingHeadline(issue.rest, ended?.how ?? null), needsYou: asked, closedBy: null };
}

/** The handoff that placed the issue, as what closed it when that is Done; null for any other place. */
const handedOffClose = ({ status }: Pick<Placing, "status">, handed: Handed | null): Closure | null =>
  status === "done" && handed !== null ? { by: "handoff", handoffId: handed.handoff.id } : null;

/**
 * A parent, placed by its sub-issues (`subIssues`, each placed by its own facts); it has no agent of
 * its own. Closed by the manager, as closed. Once every sub-issue is closed and one is Done: a kind
 * nothing verifies is Done, closed by its sub-issues' closes, whoever made each; a verified kind is
 * In progress and flagged while a Done sub-issue that ships code isn't merged, and once all are,
 * its final check places it (finalCheckPlaces). Before that: In progress once any sub-issue
 * started, Todo while any is in Todo or the manager rests the parent there, else Backlog. why every
 * sub-issue canceled reads as not started: nothing of the parent was done, so it rests where the
 * manager put it. Its headline says only what its count doesn't (headlineText joins the two): why
 * it is flagged, where its final check stands, or the manager's close; else none.
 */
function parentView({ issue, openDecision, finalCheck, verifierAsks }: IssueFacts, subIssues: readonly Placed[]): Placed {
  const done = subIssues.filter(({ status }) => status === "done");
  const base = { issue, holder: null, pr: null, placing: null, subIssues: { done: done.length, total: subIssues.length }, finalCheckDue: null };
  const final = finalOf(issue, null);
  if (final !== null) return { ...base, ...final, needsYou: null };
  const asked = openDecision ? ASKED : null;
  if (done.length > 0 && subIssues.every(({ status }) => isClosed(status))) {
    if (!isVerified(issue.kind)) return { ...base, status: "done", headline: null, needsYou: null, closedBy: closedBySubIssues(subIssues) };
    const builds = done.filter(({ issue: sub }) => shipsCode(sub.kind));
    const unmerged = builds.filter(({ pr }) => pr?.state !== "merged").map(({ issue: sub }) => sub.id);
    if (unmerged.length > 0) return { ...base, ...flagged(`${unmerged.join(", ")} ${unmerged.length === 1 ? "isn't" : "aren't"} merged, so ${issue.id}'s work isn't all on the default branch`), closedBy: null };
    const placed = finalCheckPlaces(issue, finalCheck, builds.map(({ issue: sub }) => sub.id), verifierAsks);
    return { ...base, ...placed, needsYou: placed.needsYou ?? asked };
  }
  const started = subIssues.some(({ status }) => status !== "backlog" && status !== "todo" && status !== "canceled");
  const status = started ? "in-progress" : subIssues.some(({ status }) => status === "todo") ? "todo" : issue.rest;
  return { ...base, status, headline: asked, needsYou: asked, closedBy: null };
}

/**
 * Where its final check puts a build parent whose Done build sub-issues (`merged`) are all merged.
 * A check is due when none was made, the latest judged less merged work than there is now (a fix
 * filed as a sub-issue since, Done and merged), or the latest was superseded before it judged
 * anything (an agent started on the parent while it had no sub-issues): the tick starts it
 * (final-check.ts), unless the parent has no done-criteria to check, which only the manager can
 * write. Else the latest places it: Verifying while it runs, Done when it passed, In review for
 * the manager to accept when verification was off, In progress and flagged when it failed or
 * couldn't run. why a research or canceled sub-issue since doesn't make one due: the default
 * branch holds the same work.
 */
function finalCheckPlaces(issue: Issue, latest: FinalCheck | null, merged: IssueId[], verifierAsks: boolean): Placing & Pick<Placed, "placing" | "closedBy" | "finalCheckDue"> {
  const open = { closedBy: null, finalCheckDue: null };
  const due = (): Placing & Pick<Placed, "placing" | "closedBy" | "finalCheckDue"> =>
    issue.doneCriteria.length === 0
      ? { ...flagged(`${issue.id} has no done-criteria for its final check`), placing: null, ...open }
      : { status: "verifying", headline: "Final check due", needsYou: null, placing: null, closedBy: null, finalCheckDue: merged };
  if (latest === null || merged.some((id) => !latest.subject.merged.includes(id))) return due();
  const placing = { placing: latest };
  const result = outcome(latest.verdict);
  switch (result) {
    case "pending":
    case "waiting-for-ci":
      return { status: "verifying", headline: `Final check running${asking(latest.verdict, verifierAsks)}`, needsYou: null, ...placing, ...open };
    // why due, never running: a superseded check judged nothing, and no newer one was made after it.
    case "superseded":
      return due();
    case "pass":
      return { status: "done", headline: "✓ Final check passed", needsYou: null, ...placing, closedBy: { by: "final-check", checkId: latest.id }, finalCheckDue: null };
    case "unverified":
      // why not Done: no parent is Done unchecked without the manager's accept.
      return { status: "in-review", headline: "Unverified: verification was off", needsYou: null, ...placing, ...open };
    case "fail":
      return { ...flagged("✗ Final check failed"), ...placing, ...open };
    case "could-not-run":
      return { ...flagged(`Couldn't run its final check${because(latest.verdict)}`), ...placing, ...open };
    default:
      return result satisfies never;
  }
}

/**
 * A view's headline as text prints it, with no cell for a parent's count: the count leads ("1/3
 * done"), then what the headline adds ("1/3 done. All merged: accept it with issue_update").
 */
export function headlineText({ headline, subIssues }: Pick<IssueView, "headline" | "subIssues">): string {
  const count = subIssues === null ? null : `${subIssues.done}/${subIssues.total} done`;
  return [count, headline].filter((part) => part !== null).join(". ");
}

/**
 * A parent's close by its sub-issues, all closed: each one's close, whoever made it. why every one,
 * not the last: which closed last is not known (a report closes as its turn ends, after the
 * handoff), and the work that closed the parent is all of theirs (relations.ts unblockedSince).
 */
const closedBySubIssues = (subIssues: readonly Placed[]): Closure => ({ by: "sub-issues", closes: subIssues.flatMap(({ closedBy }) => (closedBy === null ? [] : [closedBy])) });

/** Why an issue rests where the manager put it: in Todo, how its latest agent ended (null: none ever started). */
function restingHeadline(rest: Issue["rest"], endedHow: EndedHow | null): string {
  if (rest === "backlog") return "Not planned";
  switch (endedHow) {
    case null:
      return "Not started";
    case "spawn-failed":
      return "bb never started its agent's thread";
    case "stopped":
    case "archived":
    case "deleted":
    case "replaced":
      return `Its agent was ${endedHow}`;
    default:
      return endedHow satisfies never;
  }
}

/**
 * Where the manager's closing act or a merge put the issue, or null when neither did. why before
 * its agents: a merge is the user's act and final, whatever its thread does next; a check still
 * pending or failed then is never sent back.
 */
function finalOf(issue: Issue, pr: PrSnapshot | null): Pick<IssueView, "status" | "headline" | "closedBy"> | null {
  if (issue.closed !== null) return { ...CLOSED[issue.closed.as], closedBy: { by: "manager", as: issue.closed.as } };
  return pr?.state === "merged" ? { status: "done", headline: `Merged #${pr.number}`, closedBy: { by: "merge", number: pr.number } } : null;
}

/**
 * Whether the issue keeps its place once its agent ends leaving `left` (its current handoff, or
 * null), rather than resting again: it was closed or merged, or what it left places it. Ending an
 * agent asks this to decide whether the manager is told the issue returned to Todo.
 */
export const keepsPlaceAfterEnd = (issue: Issue, left: Handed | null, pr: PrSnapshot | null): boolean =>
  // why no verifier asking: it changes the headline, never the place.
  finalOf(issue, pr) !== null || (left !== null && placedByLeft(issue.kind, left, { pr, verifierAsks: false }) !== null);

/**
 * Where the handoff an ended agent left places its issue, or null when it doesn't and the issue
 * rests again. why everything but In progress: work that reached Reviewing, Verifying, In review or
 * Done survives its thread being stopped, archived or deleted; anything short of that returns to Todo.
 */
export function placedByLeft(kind: Kind, left: Handed, around: Omit<Around, "fixRounds">): Placing | null {
  const after = byHandoff(kind, left, { ...around, fixRounds: 0 });
  return after.status === "in-progress" ? null : after;
}

/** An issue an agent holds: its thread's state, else its current handoff, places it. */
function held(kind: Kind, { agent, thread, current }: NonNullable<IssueFacts["holder"]>, around: Omit<Around, "fixRounds">): Placing & Pick<IssueView, "placing"> {
  const working = (headline: string) => ({ status: "in-progress", headline, needsYou: null, placing: null }) as const;
  // why it waits on the user: agent_start binds an agent's thread or ends the agent before it answers,
  // so one still without a thread is one whose spawn the plugin stopped during and never heard the end
  // of, and only the manager ends it. A spawn still in flight reads the same for those few moments.
  if (agent.threadId === null) return { ...flagged(UNCONFIRMED), placing: null };
  if (thread === null) return working("Its thread is gone");
  if (thread.hasPendingInteraction) return { ...flagged("Waiting for an answer or an approval in its thread"), placing: null };
  switch (thread.status) {
    case "error":
      return { ...flagged("Its last turn failed"), placing: null };
    case "pending":
      return working("Waiting to start");
    case "starting":
      return working("Starting");
    case "active":
      return working("Working");
    case "stopping":
      return working("Stopping");
    case "idle":
      return current === null ? working(IDLE) : { ...byHandoff(kind, current, { ...around, fixRounds: agent.fixRounds }), placing: current.check };
    default:
      // why not throw: bb can send a status newer than this plugin's SDK. A thread in it is not
      // known to be working, so it reads as idle until bb says otherwise.
      thread.status satisfies never;
      return working(IDLE);
  }
}

const IDLE = "Its turn ended without a handoff";
const UNCONFIRMED = "No thread: bb never confirmed starting one. agent_stop ends the agent at once; then agent_start again";

/** A handoff: blocked and gave-up flag the issue; done walks the kind's stages. */
function byHandoff(kind: Kind, { handoff, check }: Handed, around: Around): Placing {
  switch (handoff.status) {
    case "blocked":
      return flagged(`Blocked: ${handoff.summary}`);
    case "gave-up":
      return flagged(`Gave up: ${handoff.summary}`);
    case "done":
      return walk(kind, { summary: handoff.summary, check, ...around });
    default:
      return handoff satisfies never;
  }
}

/** What places a handoff beside the handoff itself: its agent's fix rounds, its pull request, and whether its verifier asks a person something. */
type Around = { fixRounds: number; pr: PrSnapshot | null; verifierAsks: boolean };

type Evidence = { summary: string; check: Check | null } & Around;

/** The pipeline, run: a done handoff waits in the first of its kind's stages it hasn't left; past the last one it is Done. */
function walk(kind: Kind, evidence: Evidence): Placing {
  for (const stage of PIPELINES[kind].stages) {
    const at = STAGES[stage](evidence);
    if (at !== "left") return at;
  }
  return { status: "done", headline: `Handed off: ${evidence.summary}`, needsYou: null };
}

/** How each stage is left, defined once for every kind that passes through it. */
const STAGES: Record<Stage, (evidence: Evidence) => Placing | "left"> = {
  // Left once its review reported or none could be had, or its verdict moved on without one; at once for a check with no review stage.
  reviewing({ summary, check }) {
    const { verdict, review } = checked(check);
    return verdict.state === "queued" && isReviewing(review) ? { status: "reviewing", headline: `Reviewing: ${summary}`, needsYou: null } : "left";
  },
  // Left once the check passed, or nobody checks it. A failure stays In progress.
  verifying({ summary, check, fixRounds, pr, verifierAsks }) {
    const { verdict } = checked(check);
    const result = outcome(verdict);
    switch (result) {
      case "pending":
        return { status: "verifying", headline: `Verifying${asking(verdict, verifierAsks)}: ${summary}`, needsYou: null };
      case "waiting-for-ci":
        return { status: "verifying", headline: `Waiting for CI${pr === null ? "" : ` on #${pr.number}`}: ${summary}`, needsYou: null };
      case "pass":
      case "unverified":
        return "left";
      case "fail":
        // why: findings that reached the agent mean it is fixing them; nothing waits on the user.
        if (verdict.state === "returned" && verdict.settlement.kind === "sent-back") return { status: "in-progress", headline: `Fixing its verifier's findings: ${summary}`, needsYou: null };
        return flagged(`${failedAs(verdict)}${failureNote(verdict, fixRounds)}: ${summary}`);
      case "could-not-run":
        return flagged(`Couldn't verify${because(verdict)}: ${summary}`);
      case "superseded":
        return { status: "in-progress", headline: `Replaced by a newer handoff: ${summary}`, needsYou: null };
      default:
        return result satisfies never;
    }
  },
  // Never left inside the walk: In review ends with a merge or the manager's accept, which issueView reads first.
  "in-review"({ summary, check }) {
    const { verdict } = checked(check);
    return { status: "in-review", headline: outcome(verdict) === "pass" ? `✓ Verified${passNote(ciOfReturned(verdict))}: ${summary}` : `Unverified: ${summary}`, needsYou: null };
  },
};

/** why throw: issueViews places one view per facts, in order. */
function at(views: readonly Placed[], i: number): Placed {
  const view = views[i];
  if (view === undefined) throw new Error(`No view for issue ${i}`);
  return view;
}

/** why throw: a verified kind's done handoff is stored with its check, in one transaction. */
function checked(check: Check | null): Check {
  if (check === null) throw new Error("A done handoff of a verified kind has no check");
  return check;
}

const flagged = (reason: string): Placing => ({ status: "in-progress", headline: reason, needsYou: reason });

/** What a running check's headline adds while its verifier asks a person something. why no needsYou: the plugin declines it, and nobody need answer. */
const asking = (verdict: Verdict, verifierAsks: boolean): string =>
  verdict.state === "running" && verifierAsks ? ", its verifier asking for an answer or an approval, which the plugin declines" : "";

/** Why a check that couldn't run has no verdict, as its headline gives it. */
const because = (verdict: Verdict): string => (verdict.state === "could-not-run" ? `, as ${verdict.reason}` : "");

/**
 * What a failure's headline adds about the agent's fix round: that this verdict's findings may or
 * may not have reached it, or that it failed again after them.
 */
function failureNote(verdict: Verdict, fixRounds: number): string {
  if (mayHaveReachedAgent(verdict)) return ", its findings may or may not have reached it";
  return fixRounds > 0 ? " after its fix round" : "";
}

/** What a pass says of CI on its commit when CI didn't pass there: it couldn't be checked, or GitHub reported no checks. */
function passNote(ci: CiVerdict | null): string {
  if (ci?.kind === "not-checked") return ", CI not checked";
  return ci?.kind === "no-checks" ? ", no CI checks" : "";
}

/** What CI said about a settled verdict's commit; null for any other verdict. */
const ciOfReturned = (verdict: Verdict): CiVerdict | null => (verdict.state === "returned" ? ciVerdictOf(verdict) : null);

/** How a failure reads: by the plugin's checkout read when it failed it; as CI's, when every criterion passed and CI failed on the commit. */
function failedAs(verdict: Verdict): string {
  if (verdict.state === "returned" && failedCheckout(verdict) !== null) return `✗ ${NOT_CLEAN}`;
  const ci = ciOfReturned(verdict);
  return ci?.kind === "fail" && verdict.state === "returned" && allPassed(verdict) ? `✗ CI failed on #${ci.number}` : "✗ Failed verification";
}

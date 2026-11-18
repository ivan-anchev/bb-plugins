// Where an issue stands, why, whether it waits on the user, and what blocks it: derived from its
// stored plan and the facts beside it, never stored. Pure, so the board, crew_catch_up, issue_read,
// the rail badge, the PR watch and the unblocked announcements share one definition. The kind enters in one place: a done handoff walks its
// kind's stages (walk); everything that reads an IssueStatus never sees a kind.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Agent, EndedHow } from "../agent.ts";
import type { Handoff, HandoffId } from "../handoff.ts";
import type { Check } from "../verdict/check.ts";
import type { CiVerdict, PrSnapshot } from "../verdict/pr.ts";
import { NOT_CLEAN } from "../verdict/checkout.ts";
import { allPassed, ciVerdictOf, failedCheckout, mayHaveReachedAgent, outcome, type Verdict } from "../verdict/verdict.ts";
import type { Issue } from "./issue.ts";
import { PIPELINES, type Kind, type Stage } from "./kind.ts";
import { blockedBy, isClosed, statusIn, type Related } from "./relations.ts";

export const issueStatusSchema = z.enum(["backlog", "todo", "in-progress", "verifying", "in-review", "done", "canceled"]);
export type IssueStatus = z.infer<typeof issueStatusSchema>;

/** Each status's name, as the board and crew_catch_up show it. */
export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In progress",
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
};

export type IssueView = {
  issue: Issue;
  status: IssueStatus;
  /** Why it waits on the user, or null. A flag on an open issue, never a status. */
  needsYou: string | null;
  headline: string;
  holder: Agent | null;
  /** The check whose verdict places it (the board's verdict), or null. */
  placing: Check | null;
  pr: PrSnapshot | null;
  /** The open issues it depends on, each with its status; none once it is closed itself. Derived from the other views, never stored. */
  blockedBy: Related[];
  /** What closed it (null: it is open). */
  closedBy: Closure | null;
};

/**
 * What closed an issue: the manager's act, its pull request merged, or the handoff that made it
 * Done. Two closes of one issue are the same close only when these are equal: a research issue
 * reopened and reported again is closed by another handoff.
 */
export type Closure = { by: "manager"; as: NonNullable<Issue["closed"]>["as"]; at: number } | { by: "merge"; number: number } | { by: "handoff"; handoffId: HandoffId };

/** A view before its dependencies are read: where its own facts place it. */
type Placed = Omit<IssueView, "blockedBy">;

type Placing = Pick<IssueView, "status" | "headline" | "needsYou">;

/**
 * Every issue of one regional manager, viewed: each placed by its own facts, then blocked by the
 * statuses so placed. why from the same views: what blocks an issue can never disagree with the
 * status shown for its dependency.
 */
export function issueViews(all: readonly IssueFacts[]): IssueView[] {
  const placed = all.map(issueView);
  const statuses = new Map(placed.map(({ issue, status }) => [issue.id, status]));
  return placed.map((view) => ({ ...view, blockedBy: isClosed(view.status) ? [] : blockedBy(view.issue, null, (id) => statusIn(statuses, id)) }));
}

const ASKED = "Waiting on your answer to its decision";

/** How the manager's two closing acts place an issue. */
const CLOSED = { canceled: { status: "canceled", headline: "Canceled" }, accepted: { status: "done", headline: "Accepted" } } as const;

function issueView({ issue, holder, ended, pr, openDecision }: IssueFacts): Placed {
  const base = { issue, holder: holder?.agent ?? null, pr, placing: null };
  const final = finalOf(issue, pr);
  if (final !== null) return { ...base, ...final, needsYou: null };
  const asked = openDecision ? ASKED : null;
  if (holder !== null) {
    const placed = held(issue.kind, holder, pr);
    return { ...base, ...placed, needsYou: placed.needsYou ?? asked, closedBy: handedOffClose(placed, holder.current) };
  }
  const left = ended?.left ?? null;
  const after = left === null ? null : placedByLeft(issue.kind, left, pr);
  if (left !== null && after !== null) return { ...base, ...after, placing: left.check, needsYou: after.needsYou ?? asked, closedBy: handedOffClose(after, left) };
  return { ...base, status: issue.rest, headline: restingHeadline(issue.rest, ended?.how ?? null), needsYou: asked, closedBy: null };
}

/** The handoff that placed the issue, as what closed it when that is Done; null for any other place. */
const handedOffClose = ({ status }: Pick<Placing, "status">, handed: Handed | null): Closure | null => (status === "done" && handed !== null ? { by: "handoff", handoffId: handed.handoff.id } : null);

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
  if (issue.closed !== null) return { ...CLOSED[issue.closed.as], closedBy: { by: "manager", ...issue.closed } };
  return pr?.state === "merged" ? { status: "done", headline: `Merged #${pr.number}`, closedBy: { by: "merge", number: pr.number } } : null;
}

/**
 * Whether the issue keeps its place once its agent ends leaving `left` (its current handoff, or
 * null), rather than resting again: it was closed or merged, or what it left places it. Ending an
 * agent asks this to decide whether the manager is told the issue returned to Todo.
 */
export const keepsPlaceAfterEnd = (issue: Issue, left: Handed | null, pr: PrSnapshot | null): boolean =>
  finalOf(issue, pr) !== null || (left !== null && placedByLeft(issue.kind, left, pr) !== null);

/**
 * Where the handoff an ended agent left places its issue, or null when it doesn't and the issue
 * rests again. why everything but In progress: work that reached Verifying, In review or Done
 * survives its thread being stopped, archived or deleted; anything short of that returns to Todo.
 */
export function placedByLeft(kind: Kind, left: Handed, pr: PrSnapshot | null): Placing | null {
  const after = byHandoff(kind, left, 0, pr);
  return after.status === "in-progress" ? null : after;
}

/** An issue an agent holds: its thread's state, else its current handoff, places it. */
function held(kind: Kind, { agent, thread, current }: NonNullable<IssueFacts["holder"]>, pr: PrSnapshot | null): Placing & Pick<IssueView, "placing"> {
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
      return current === null ? working(IDLE) : { ...byHandoff(kind, current, agent.fixRounds, pr), placing: current.check };
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
function byHandoff(kind: Kind, { handoff, check }: Handed, fixRounds: number, pr: PrSnapshot | null): Placing {
  switch (handoff.status) {
    case "blocked":
      return flagged(`Blocked: ${handoff.summary}`);
    case "gave-up":
      return flagged(`Gave up: ${handoff.summary}`);
    case "done":
      return walk(kind, { summary: handoff.summary, check, fixRounds, pr });
    default:
      return handoff satisfies never;
  }
}

type Evidence = { summary: string; check: Check | null; fixRounds: number; pr: PrSnapshot | null };

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
  // Left once the check passed, or nobody checks it. A failure stays In progress.
  verifying({ summary, check, fixRounds, pr }) {
    const { verdict } = checked(check);
    const result = outcome(verdict);
    switch (result) {
      case "pending":
        return { status: "verifying", headline: `Verifying: ${summary}`, needsYou: null };
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
        return flagged(`Couldn't verify: ${summary}`);
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

/** why throw: a verified kind's done handoff is stored with its check, in one transaction. */
function checked(check: Check | null): Check {
  if (check === null) throw new Error("A done handoff of a verified kind has no check");
  return check;
}

const flagged = (reason: string): Placing => ({ status: "in-progress", headline: reason, needsYou: reason });

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

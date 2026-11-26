// A board's lanes: the issues, each placed by its status, or under Needs you while it waits on the
// user, and each sub-issue under its parent; and, under Needs you, the questions asked before every
// question had to name an issue. The board draws them, crew_catch_up lists them and the panel's badge
// counts the issues under Needs you, so the three never disagree.
import { z } from "zod";
import { isOpen, type Decision, type OpenDecision } from "../decision.ts";
import type { IssueId } from "../issue/issue.ts";
import { isClosed } from "../issue/relations.ts";
import { STATUS_LABELS, type IssueStatus } from "../issue/status.ts";
import { stillWaits } from "../verdict/rounds/cap.ts";

/** The board's lanes, in the order it shows them. */
const laneSchema = z.enum(["needs-you", "in-review", "verifying", "reviewing", "in-progress", "todo", "backlog", "done", "canceled"]);
export type Lane = z.infer<typeof laneSchema>;

/** Each lane's name, as the board and crew_catch_up show it. */
export const LANE_LABELS: Record<Lane, string> = { "needs-you": "Needs you", ...STATUS_LABELS };

/** What places an issue in a lane: its status, and why it waits on the user (null: it doesn't). */
type Placed = { status: IssueStatus; needsYou: string | null };

/** What places an issue on the board: what places it in a lane, its id, and its parent (null: none). */
type Nested = Placed & { id: IssueId; parentId: IssueId | null };

/** An issue's lane: Needs you while it waits on the user, else its status. */
export const laneOf = ({ status, needsYou }: Placed): Lane => (needsYou === null ? status : "needs-you");

/**
 * The decisions that wait for the user: each open one, but a cap question whose issue closed
 * meanwhile, as by a merge or a cancel (rounds/cap.ts stillWaits): nothing is left for its answer
 * to allow. why derived here and stored nowhere: the board, the rail badge and crew_catch_up read
 * it alike, each from the issues of the same read as its decisions.
 */
export function waitingDecisions(decisions: readonly Decision[], issues: readonly Pick<Nested, "id" | "status">[]): OpenDecision[] {
  const closed = new Set(issues.flatMap(({ id, status }) => (isClosed(status) ? [id] : [])));
  return decisions.filter(isOpen).filter((decision) => stillWaits(decision, decision.issueId !== null && closed.has(decision.issueId)));
}

/** The rows in each lane that has any, in the board's order; rows keep their order. */
function byLane<Row extends { lane: Lane }>(rows: readonly Row[]): { lane: Lane; rows: Row[] }[] {
  return laneSchema.options.flatMap((lane) => {
    const inLane = rows.filter((row) => row.lane === lane);
    return inLane.length === 0 ? [] : [{ lane, rows: inLane }];
  });
}

/** A question waiting for the user that names no issue: one asked before crew_ask_user required one. No new one can be asked. */
export type UnfiledQuestion = OpenDecision & { issueId: null };
const isUnfiled = (decision: OpenDecision): decision is UnfiledQuestion => decision.issueId === null;

/**
 * A row on the board: a question waiting for the user that names no issue; a top-level issue, with its
 * sub-issues under it but its canceled ones (none: it has none), whatever their own lanes; a
 * sub-issue that waits on the user, listed flat under Needs you as well as under its parent; or a
 * canceled sub-issue, which lives under Canceled, apart from its parent.
 */
export type BoardItem<Issue> =
  | { kind: "unfiled-question"; lane: "needs-you"; decision: UnfiledQuestion }
  | { kind: "issue"; lane: Lane; issue: Issue; subIssues: Issue[] }
  | { kind: "flagged-sub-issue"; lane: "needs-you"; issue: Issue }
  | { kind: "canceled-sub-issue"; lane: "canceled"; issue: Issue };

/**
 * The board's rows in each lane that has any, in the board's order. A question that names no issue
 * sits under Needs you, first there, until the user answers it, then leaves the board. A question
 * that names an issue has no row of its own: it flags its issue, whose Needs you line says it
 * (status.ts waitingOn). A top-level issue sits in its own lane, its sub-issues under it; a flagged
 * issue sits under Needs you only, never also in its status's lane, and a flagged sub-issue under
 * its parent too. A canceled sub-issue sits under Canceled, never under its parent: nothing of it
 * is left to do or was done, so its parent doesn't count it either (status.ts parentView).
 * A lane counts its rows: its sub-issues are counted by their parent.
 */
export function boardGroups<Issue extends Nested>(decisions: readonly Decision[], issues: readonly Issue[]): { lane: Lane; rows: BoardItem<Issue>[] }[] {
  const subIssuesOf = (id: IssueId): Issue[] => issues.filter(({ parentId, status }) => parentId === id && status !== "canceled");
  return byLane<BoardItem<Issue>>([
    ...waitingDecisions(decisions, issues).filter(isUnfiled).map((decision) => ({ kind: "unfiled-question", lane: "needs-you", decision }) as const),
    ...issues.flatMap((issue): BoardItem<Issue>[] => {
      if (issue.parentId === null) return [{ kind: "issue", lane: laneOf(issue), issue, subIssues: subIssuesOf(issue.id) }];
      return [
        ...(issue.status === "canceled" ? [{ kind: "canceled-sub-issue", lane: "canceled", issue } as const] : []),
        ...(issue.needsYou === null ? [] : [{ kind: "flagged-sub-issue", lane: "needs-you", issue } as const]),
      ];
    }),
  ]);
}

/**
 * How many issues wait for the user on one board: each issue under Needs you once, a flagged
 * sub-issue as its own row. why issues only: a question on an issue flags that issue, so counting
 * the question too would count it twice.
 */
export const needsYouSchema = z.number().int().nonnegative();

export const needsYou = (issues: readonly Placed[]): number => issues.filter((issue) => laneOf(issue) === "needs-you").length;

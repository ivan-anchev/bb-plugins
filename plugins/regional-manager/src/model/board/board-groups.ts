// A board's lanes: the decisions waiting for the user and the issues, each issue placed by its
// status, or under Needs you while it waits on the user, and each sub-issue under its parent. The
// board draws them, crew_catch_up lists them and the panel's badge counts their Needs you, so the
// three never disagree.
import { z } from "zod";
import { isOpen, type Decision, type OpenDecision } from "../decision.ts";
import type { IssueId } from "../issue/issue.ts";
import { STATUS_LABELS, type IssueStatus } from "../issue/status.ts";

/** The board's lanes, in the order it shows them. */
const laneSchema = z.enum(["needs-you", "in-review", "verifying", "in-progress", "todo", "backlog", "done", "canceled"]);
export type Lane = z.infer<typeof laneSchema>;

/** Each lane's name, as the board and crew_catch_up show it. */
export const LANE_LABELS: Record<Lane, string> = { "needs-you": "Needs you", ...STATUS_LABELS };

/** What places an issue in a lane: its status, and why it waits on the user (null: it doesn't). */
type Placed = { status: IssueStatus; needsYou: string | null };

/** What places an issue on the board: what places it in a lane, its id, and its parent (null: none). */
type Nested = Placed & { id: IssueId; parentId: IssueId | null };

/** An issue's lane: Needs you while it waits on the user, else its status. */
export const laneOf = ({ status, needsYou }: Placed): Lane => (needsYou === null ? status : "needs-you");

/** The rows in each lane that has any, in the board's order; rows keep their order. */
function byLane<Row extends { lane: Lane }>(rows: readonly Row[]): { lane: Lane; rows: Row[] }[] {
  return laneSchema.options.flatMap((lane) => {
    const inLane = rows.filter((row) => row.lane === lane);
    return inLane.length === 0 ? [] : [{ lane, rows: inLane }];
  });
}

/**
 * A row on the board: a decision waiting for the user's answer; a top-level issue, with its
 * sub-issues under it (none: it has none), whatever their own lanes; or a sub-issue that waits on
 * the user, listed flat under Needs you as well as under its parent.
 */
export type BoardItem<Issue> =
  | { kind: "decision"; lane: "needs-you"; decision: OpenDecision }
  | { kind: "issue"; lane: Lane; issue: Issue; subIssues: Issue[] }
  | { kind: "flagged-sub-issue"; lane: "needs-you"; issue: Issue };

/**
 * The board's rows in each lane that has any, in the board's order. A decision sits under Needs you
 * until the user answers it, first there, and then leaves the board: it stays among its issue's
 * decisions (issue-detail.tsx, issue_read). A top-level issue sits in its own lane, its sub-issues
 * under it; a flagged issue sits under Needs you only, never also in its status's lane, and a
 * flagged sub-issue under its parent too.
 * A lane counts its rows: its sub-issues are counted by their parent.
 */
export function boardGroups<Issue extends Nested>(decisions: readonly Decision[], issues: readonly Issue[]): { lane: Lane; rows: BoardItem<Issue>[] }[] {
  const subIssuesOf = (id: IssueId): Issue[] => issues.filter(({ parentId }) => parentId === id);
  return byLane<BoardItem<Issue>>([
    ...decisions.filter(isOpen).map((decision) => ({ kind: "decision", lane: "needs-you", decision }) as const),
    ...issues.flatMap((issue): BoardItem<Issue>[] => {
      if (issue.parentId === null) return [{ kind: "issue", lane: laneOf(issue), issue, subIssues: subIssuesOf(issue.id) }];
      return issue.needsYou === null ? [] : [{ kind: "flagged-sub-issue", lane: "needs-you", issue }];
    }),
  ]);
}

/** What waits for the user on one board: how many of its decisions and its issues sit under Needs you. */
export const needsYouSchema = z.object({ decisions: z.number().int().nonnegative(), issues: z.number().int().nonnegative() });
export type NeedsYou = z.infer<typeof needsYouSchema>;

/** What sits under Needs you: each decision and each issue there once, a flagged sub-issue as its own row. */
export function needsYou(decisions: readonly Decision[], issues: readonly Placed[]): NeedsYou {
  return { decisions: decisions.filter(isOpen).length, issues: issues.filter((issue) => laneOf(issue) === "needs-you").length };
}

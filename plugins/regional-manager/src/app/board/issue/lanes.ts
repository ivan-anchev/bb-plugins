// The board's lanes, in order: Needs you (open decisions, then every issue waiting on the user,
// whatever its status), then one lane per status. A sub-issue sits under its parent in the parent's
// lane, and under Needs you too while it waits on the user. Answered decisions lead Done. An empty
// lane is not drawn.
import type { Decision } from "../../../model/decision.ts";
import type { IssueStatus } from "../../../model/issue/status.ts";
import type { BoardIssue } from "./board-issue.ts";

export type LaneKey = "needs-you" | IssueStatus;

export type LaneItem = { kind: "decision"; decision: Decision } | { kind: "issue"; issue: BoardIssue; depth: 0 | 1 };

/** `count`: what the lane holds, its sub-issues aside (they count under their parent). */
export type Lane = { key: LaneKey; count: number; items: LaneItem[] };

/** The status lanes under Needs you, in order, and whether each starts folded. */
export const LANES: readonly { status: IssueStatus; folded: boolean }[] = [
  { status: "in-review", folded: false },
  { status: "verifying", folded: false },
  { status: "in-progress", folded: false },
  { status: "todo", folded: false },
  { status: "backlog", folded: true },
  { status: "done", folded: true },
  { status: "canceled", folded: true },
];

export function lanesOf(decisions: readonly Decision[], issues: readonly BoardIssue[]): Lane[] {
  const open = decisions.filter((decision) => decision.answer === null).map(decisionItem);
  const answered = decisions.filter((decision) => decision.answer !== null).map(decisionItem);
  const withSubIssues = (parent: BoardIssue): LaneItem[] => [issueItem(parent, 0), ...issues.filter((issue) => issue.parentId === parent.id).map((sub) => issueItem(sub, 1))];
  const flagged = issues.filter((issue) => issue.needsYou !== null);
  // why a parent brings its sub-issues: they sit under it wherever it is; a sub-issue alone is drawn flat.
  const needsYou = [...open, ...flagged.flatMap((issue) => (issue.parentId === null ? withSubIssues(issue) : [issueItem(issue, 0)]))];
  // why top-level only: an issue waiting on the user is under Needs you instead; a sub-issue stays under its parent too.
  const settled = issues.filter((issue) => issue.parentId === null && issue.needsYou === null);
  const lanes: Lane[] = [
    { key: "needs-you", count: open.length + flagged.length, items: needsYou },
    ...LANES.map(({ status }) => {
      const inLane = settled.filter((issue) => issue.status === status);
      const leading = status === "done" ? answered : [];
      return { key: status, count: leading.length + inLane.length, items: [...leading, ...inLane.flatMap(withSubIssues)] };
    }),
  ];
  return lanes.filter((lane) => lane.count > 0);
}

const decisionItem = (decision: Decision): LaneItem => ({ kind: "decision", decision });
const issueItem = (issue: BoardIssue, depth: 0 | 1): LaneItem => ({ kind: "issue", issue, depth });

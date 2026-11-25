// A parent's sub-issues under its row, hung on the rails (rails.tsx): a hairline trunk under the
// parent's glyph bends into each sub-issue. Each sub-issue is a row of its own, one line, set in by
// the rails. While the parent isn't Done, its Done sub-issues fold behind one "+N completed" row at
// the end, which unfolds them in place under it; once the parent is Done, each is listed, as
// nothing else is left there. Its canceled ones are never here: they live under Canceled
// (board-groups.ts).
import type { ReactNode, RefCallback } from "react";
import type { IssueRow as Row } from "../../../../contract.ts";
import { CompletedRow } from "./completed-row.tsx";
import { Rails, type RailShape } from "./rails.tsx";

type SubIssueTreeProps = {
  /** The list's id, which the parent's count names as what it folds. */
  id: string;
  parent: Row;
  subIssues: readonly Row[];
  /** Whether the Done sub-issues show, unfolded from behind their row, and the fold. */
  completed: { open: boolean; onToggle(): void };
  /** The item's ref, that keeps focus as it moves (focus-hand-off.ts useFocusKeptAcrossGroups). */
  itemRef(sub: Row): RefCallback<HTMLElement>;
  /** The parent's row has its ask under its title (issue-row.tsx), so the first rail reaches past it up to the glyph. */
  parentAsks: boolean;
  children(sub: Row): ReactNode;
};

export function SubIssueTree({ id, parent, subIssues, completed, itemRef, parentAsks, children }: SubIssueTreeProps) {
  const lines = linesOf(parent, subIssues, completed.open);
  const reach = ONE_LINE_REACH + (parentAsks ? ASK_LINE : 0);
  return (
    <ul id={id} className="rmi-list rmi-sub-issues">
      {lines.map((line, i) => (
        <li key={line.kind === "sub-issue" ? line.issue.id : COMPLETED_KEY} ref={line.kind === "sub-issue" ? itemRef(line.issue) : undefined}>
          <Rails shape={ROW_RAILS} reach={i === 0 ? reach : 0} last={i === lines.length - 1} />
          {line.kind === "sub-issue" ? children(line.issue) : <CompletedRow count={line.count} open={completed.open} controls={id} onToggle={completed.onToggle} />}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ layer 2

/** A line of the tree: a sub-issue's row, or the row its Done ones fold behind. */
type Line = { kind: "sub-issue"; issue: Row } | { kind: "completed"; count: number };

/** The tree's lines: every sub-issue under a Done parent; else those not Done, then the row the Done ones fold behind, then those, while they show. */
function linesOf(parent: Row, subIssues: readonly Row[], completedOpen: boolean): Line[] {
  const line = (issue: Row): Line => ({ kind: "sub-issue", issue });
  if (parent.status === "done") return subIssues.map(line);
  const done = subIssues.filter(({ status }) => status === "done");
  const open = subIssues.filter(({ status }) => status !== "done").map(line);
  if (done.length === 0) return open;
  return [...open, { kind: "completed", count: done.length }, ...(completedOpen ? done.map(line) : [])];
}

/** The completed row's key among the sub-issues'. why it can't collide: an issue's id has no space. */
const COMPLETED_KEY = "+ completed";

/** How far the first rail reaches up past a one-line parent row: from its glyph's foot (15 + 7) to its row's foot (30). */
const ONE_LINE_REACH = 8;
/** The height an ask adds under a row's title (issue-row.css `.rmi-rowbox[data-asks]`). */
const ASK_LINE = 18;

/** A sub-issue's row is one line, 30 tall; the trunk runs on pixels 14–15, under the centre of the parent's glyph in its 30 slot, and the elbow ends short of the sub-issue's own glyph (issue-row.css `.rmi-sub-issues > li`). */
const ROW_RAILS: RailShape = { line: 30, trunk: 14.5, tip: 26 };

// A parent's sub-issues under its row, hung on the rails (rails.tsx): a hairline trunk under the
// parent's glyph bends into each sub-issue. Each sub-issue is a row of its own, one line, set in by
// the rails.
import type { ReactNode, RefCallback } from "react";
import { Rails, type RailShape } from "./rails.tsx";

type SubIssueTreeProps<Sub> = {
  subIssues: readonly Sub[];
  keyOf(sub: Sub): string;
  /** The item's ref, that keeps focus as it moves (focus-hand-off.ts useFocusKeptAcrossGroups). */
  itemRef(sub: Sub): RefCallback<HTMLElement>;
  /** The parent's row has its ask under its title (issue-row.tsx), so the first rail reaches past it up to the glyph. */
  parentAsks: boolean;
  children(sub: Sub): ReactNode;
};

export function SubIssueTree<Sub>({ subIssues, keyOf, itemRef, parentAsks, children }: SubIssueTreeProps<Sub>) {
  const reach = ONE_LINE_REACH + (parentAsks ? ASK_LINE : 0);
  return (
    <ul className="rmi-list rmi-sub-issues">
      {subIssues.map((sub, i) => (
        <li key={keyOf(sub)} ref={itemRef(sub)}>
          <Rails shape={ROW_RAILS} reach={i === 0 ? reach : 0} last={i === subIssues.length - 1} />
          {children(sub)}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ layer 2

/** How far the first rail reaches up past a one-line parent row: from its glyph's foot (15 + 7) to its row's foot (30). */
const ONE_LINE_REACH = 8;
/** The height an ask adds under a row's title (issue-row.css `.rmi-rowbox[data-asks]`). */
const ASK_LINE = 18;

/** A sub-issue's row is one line, 30 tall; the trunk runs on pixels 14–15, under the centre of the parent's glyph in its 30 slot, and the elbow ends short of the sub-issue's own glyph (issue-row.css `.rmi-sub-issues > li`). */
const ROW_RAILS: RailShape = { line: 30, trunk: 14.5, tip: 26 };

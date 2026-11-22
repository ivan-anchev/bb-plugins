// A parent's sub-issues under its row, hung on Activity Sidebar's subthread rails
// (src/ui/card/subthread-section.tsx Rails), copied since plugins cannot import each other: a
// hairline trunk under the parent's glyph bends, radius 4, into each sub-issue, and runs on past it
// unless it is the last. Each sub-issue is a row of its own, one line, set in by the rails.
import type { ReactNode, RefCallback } from "react";

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
          <Rails reach={i === 0 ? reach : 0} last={i === subIssues.length - 1} />
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

const CH = 30; // a sub-issue's row: one line
const BEND = 4; // the elbow's radius
const TRUNK = 14.5; // the 1px trunk on pixels 14–15, under the centre of the parent's glyph in its 30 slot
const TIP = 26; // where the elbow ends, short of the sub-issue's own glyph (issue-row.css `.rmi-sub-issues > li`)

/** One sub-issue's hairlines: the trunk coming down to it (from the parent's glyph, for the first) and bending into it, and on below unless it is the last. */
function Rails({ reach, last }: { reach: number; last: boolean }) {
  const mid = CH / 2;
  let d = `M${TRUNK} ${-reach}V${mid - BEND}A${BEND} ${BEND} 0 0 0 ${TRUNK + BEND} ${mid}H${TIP}`;
  if (!last) d += `M${TRUNK} ${mid - BEND}V${CH}`;
  return (
    <svg className="rmi-rails" width={TIP + 1} height={CH} aria-hidden>
      <path d={d} />
    </svg>
  );
}

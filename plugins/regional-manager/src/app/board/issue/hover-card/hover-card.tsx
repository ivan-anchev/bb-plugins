// A row's hover card (use-hover-card.ts says when it shows), Activity Sidebar's card by the row
// (src/ui/card/card-body.tsx): the issue's title whole, up to three lines; its status, and its agent;
// what it waits on the user for, or else its headline, which the row leaves out; its pills spelled
// out; and its sub-issues as a tree on the board's rails, or what blocks it and what it blocks, each
// the other issue's glyph, id and title. It opens under its row, or above it where the panel has no
// room below (placement.ts). Display only, and hidden from a screen reader: the row's label speaks
// all of it, and pressing the row opens the issue's tab, which holds the rest.
import "./hover-card.css";
import type { CSSProperties } from "react";
import type { IssueRow as Row } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { FadingText } from "../row/fading-text.tsx";
import { IssuePills } from "../row/pills.tsx";
import { Rails, type RailShape } from "../row/rails.tsx";
import { NeedsYouGlyph, StatusGlyph } from "../status-glyph.tsx";
import { useCardPlacement, type Placement } from "./placement.ts";

type HoverCardProps = {
  issue: Row;
  /** Every issue on the board, which its sub-issues and blockers are. */
  issues: readonly Row[];
};

export function HoverCard({ issue, issues }: HoverCardProps) {
  const { ref, placement } = useCardPlacement();
  const pick = (ids: readonly IssueId[]) => issues.filter(({ id }) => ids.includes(id));
  return (
    <div ref={ref} className="rmi-card" data-side={placement.side} style={capStyle(placement)} aria-hidden>
      <div className="rmi-card-body">
        <p className="rmi-card-title">{issue.title}</p>
        <p className="rmi-card-when">
          {STATUS_LABELS[issue.status]}
          {issue.agent !== null && ` · ${issue.agent.id}`}
        </p>
        {issue.needsYou === null ? (
          issue.headline !== null && <p className="rmi-card-headline">{issue.headline}</p>
        ) : (
          <div className="rmi-card-ask">
            <p className="rmi-card-asks">Needs you</p>
            <p className="rmi-card-headline">{issue.needsYou}</p>
          </div>
        )}
        {(issue.subIssues !== null || issue.blockedBy.length > 0 || issue.blocks.length > 0) && (
          <div className="rmi-card-facts">
            <IssuePills issue={issue} length="long" />
          </div>
        )}
        <SubIssues rows={issues.filter(({ parentId }) => parentId === issue.id)} />
        <Related title="Blocked by" rows={pick(issue.blockedBy)} />
        <Related title="Blocks" rows={pick(issue.blocks)} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/** The card's height cap, when its side of the row has too little room (hover-card.css `.rmi-card-body`). */
const capStyle = ({ cap }: Placement): (CSSProperties & Record<"--rmi-card-cap", string>) | undefined => (cap === null ? undefined : { "--rmi-card-cap": `${cap}px` });

/** The parent's sub-issues, hung from its heading on the rails, as on the board; none when it has none. */
function SubIssues({ rows }: { rows: readonly Row[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rmi-card-section">
      <p className="rmi-card-section-title">Sub-issues</p>
      <ul className="rmi-card-tree">
        {rows.map((row, i) => (
          <li key={row.id}>
            <Rails shape={CARD_RAILS} reach={i === 0 ? HEADING_REACH : 0} last={i === rows.length - 1} />
            <Line row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A card line is 22 tall; the trunk runs under the heading's first letter, and the elbow ends short of the line's glyph (hover-card.css `.rmi-card-tree > li`). */
const CARD_RAILS: RailShape = { line: 22, trunk: 4.5, tip: 14 };
/** How far the first rail reaches up to the heading: the gap under it. */
const HEADING_REACH = 2;

/** A section of related issues, each a line of its own; none when there are none. */
function Related({ title, rows }: { title: string; rows: readonly Row[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rmi-card-section">
      <p className="rmi-card-section-title">{title}</p>
      {rows.map((row) => (
        <Line key={row.id} row={row} />
      ))}
    </div>
  );
}

/** Another issue as the card names it: its glyph, its id and its title. */
function Line({ row }: { row: Row }) {
  return (
    <div className="rmi-card-line">
      {row.needsYou === null ? <StatusGlyph status={row.status} still /> : <NeedsYouGlyph />}
      <span className="rmi-card-id">{row.id}</span>
      <FadingText text={row.title} />
    </div>
  );
}

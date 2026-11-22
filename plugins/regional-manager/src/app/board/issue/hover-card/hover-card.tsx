// A row's hover card (use-hover-card.ts says when it shows), Activity Sidebar's card by the row
// (src/ui/card/card-body.tsx): the issue's title whole, up to three lines; its status, and its agent;
// what it waits on the user for, or else its headline, which the row leaves out; its pills spelled
// out; and its sub-issues as a tree on the board's rails, or what blocks it and what it blocks, each
// the other issue's glyph, id and title. It opens under its row, or above it where the panel has no
// room below (placement.ts). Display only: the row's label speaks all of it, and pressing the row
// opens the issue's tab, which holds the rest, so the card is hidden from a screen reader, unless it
// is capped: then its body scrolls, and is a labelled tab stop the keyboard reaches and scrolls
// (REVIEW.md). Focus in the card goes back to its row as the card goes, however it is put away.
import "./hover-card.css";
import { useCallback, type CSSProperties } from "react";
import type { IssueRow as Row } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { FadingText } from "../row/fading-text.tsx";
import { IssuePills } from "../row/pills.tsx";
import { Rails, type RailShape } from "../row/rails.tsx";
import { handFocusTo } from "../../../ui/focus-hand-off.ts";
import { NeedsYouGlyph, StatusGlyph } from "../status-glyph.tsx";
import { useCardPlacement, type Placement } from "./placement.ts";

type HoverCardProps = {
  issue: Row;
  /** Every issue on the board, which its sub-issues and blockers are. */
  issues: readonly Row[];
};

export function HoverCard({ issue, issues }: HoverCardProps) {
  const { ref, placement } = useCardPlacement();
  // why one callback: placement measures the card, and the card hands focus back to its row as it unmounts; a ref that changed per render would hand it back on every render.
  const cardRef = useCallback((card: HTMLDivElement | null) => {
    ref.current = card;
    return focusBackToRow(card);
  }, [ref]);
  const pick = (ids: readonly IssueId[]) => issues.filter(({ id }) => ids.includes(id));
  const capped = placement.cap !== null;
  return (
    <div ref={cardRef} className="rmi-card" data-side={placement.side} style={capStyle(placement)} aria-hidden={!capped || undefined}>
      <div className="rmi-card-body" tabIndex={capped ? 0 : undefined} role={capped ? "region" : undefined} aria-label={capped ? `Details of ${issue.id}` : undefined}>
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

/** On the card: focus in it, on its scrolling body, goes to its row's button as it unmounts, so it never drops to the page (REVIEW.md). */
const focusBackToRow = handFocusTo((card) => card.closest(".rmi-rowbox")?.querySelector<HTMLElement>(".rmi-row"));

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

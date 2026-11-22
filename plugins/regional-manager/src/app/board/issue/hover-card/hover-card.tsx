// An issue's hover card (card-intent.ts says when it shows), Activity Sidebar's card by the row
// (src/ui/card/card-body.tsx): the issue's title whole, up to three lines; its status, and its agent;
// what it waits on the user for, or else its headline, which the row leaves out; its pills spelled
// out; and its sub-issues as a tree on the board's rails, or what blocks it and what it blocks, each
// the other issue's glyph, id and title. A board row's card opens under its row, or above it where
// the panel has no room below; an issue link's card in chat floats by the link, fixed in the window
// (placement.ts). Display only: the row's label, or the link, names the issue, and pressing either
// opens the issue's tab, which holds the rest, so the card is hidden from a screen reader, unless it
// is capped: then its body scrolls, and is a labelled tab stop the keyboard reaches and scrolls
// (REVIEW.md). Focus in the card goes back to its row, or its link, as the card goes, however it is
// put away.
import "./hover-card.css";
import { useCallback, useEffect, useLayoutEffect, type CSSProperties } from "react";
import type { IssueRow as Row } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { FadingText } from "../row/fading-text.tsx";
import { IssuePills } from "../row/pills.tsx";
import { Rails, type RailShape } from "../row/rails.tsx";
import { handFocusTo } from "../../../ui/focus-hand-off.ts";
import { IssueGlyph } from "../status-glyph.tsx";
import type { CardPresence } from "./card-intent.ts";
import { useCardPlacement, type Placement } from "./placement.ts";

/** A link's card, floating in the window (hover-card.css), which chat-links/ finds focus and the pointer in. */
export const FLOATING_CARD = ".rmi-card-floating";

type HoverCardProps = {
  issue: Row;
  /** Every issue on the board, which its sub-issues and blockers are. */
  issues: readonly Row[];
  /** The link in chat the card floats by, fixed; left out: the card sits in its board row's box. */
  link?: HTMLElement;
  /** Its line to the intent that shows it: Escape puts it away, wherever focus is, and it is on screen while mounted. */
  presence: CardPresence;
  /** Why the latest read of the board failed while the card shows what an earlier one read; left out: it didn't. */
  failure?: string;
};

export function HoverCard({ issue, issues, link, presence, failure }: HoverCardProps) {
  useEscapeCloses(presence.close);
  useEffect(() => presence.mounted(), [presence]);
  const { ref, placement } = useCardPlacement(link ?? null);
  // why one callback: placement measures the card, and the card hands focus back as it unmounts; a ref that changed per render would hand it back on every render.
  const cardRef = useCallback((card: HTMLDivElement | null) => {
    ref.current = card;
    return handFocusTo((region) => triggerOf(region, link))(card);
  }, [ref, link]);
  const pick = (ids: readonly IssueId[]) => issues.filter(({ id }) => ids.includes(id));
  const capped = placement.cap !== null;
  // why: a card that no longer needs its cap has no tab stop and is hidden from a screen reader, so focus in it goes back to its row or link (REVIEW.md).
  useLayoutEffect(() => {
    const card = ref.current;
    if (!capped && card !== null && card.contains(document.activeElement)) triggerOf(card, link)?.focus();
  }, [capped, ref, link]);
  return (
    <div ref={cardRef} className={link === undefined ? "rmi-card" : "rmi-card rmi-card-floating"} data-side={placement.side} style={placeStyle(placement)} aria-hidden={!capped || undefined}>
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
        {failure !== undefined && <p className="rmi-card-failure">Couldn&apos;t refresh: {failure}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * Escape, wherever focus is, puts the card away and holds bb's own Escape, which would leave the page,
 * only while the card is mounted, so nothing hidden ever swallows it. why the document, bubbling: what
 * has focus acts on Escape first, and bb's, on the window, after; it skips an Escape whose default was
 * prevented.
 */
function useEscapeCloses(onClose: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

/** What focus in the card goes back to, as it unmounts or loses its cap, so it never drops to the page or into a hidden card (REVIEW.md): its link, or its row's button. */
const triggerOf = (card: HTMLElement, link: HTMLElement | undefined): HTMLElement | null | undefined => link ?? card.closest(".rmi-rowbox")?.querySelector<HTMLElement>(".rmi-row");

/** A floating card's place in the window, and the card's height cap when its side of its anchor has too little room (hover-card.css `.rmi-card-body`). */
const placeStyle = ({ cap, at }: Placement): CSSProperties & Partial<Record<"--rmi-card-cap", string>> => ({
  ...(at ?? {}),
  ...(cap === null ? {} : { "--rmi-card-cap": `${cap}px` }),
});

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
      <IssueGlyph issue={row} />
      <span className="rmi-card-id">{row.id}</span>
      <FadingText text={row.title} />
    </div>
  );
}

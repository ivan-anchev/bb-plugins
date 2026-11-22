// Where a hover card goes, so it is never cut off: under its anchor when it fits there, else above it
// when there is more room above, and capped to the room on its side, scrolling inside, when it fits
// on neither. A row's card sits in the row's box and keeps inside the panel the board scrolls in; a
// link's card floats, fixed, against the window, by the link's box, so the message list it sits in
// clips none of it, and follows the link, on whichever side has room, as anything holding it scrolls
// or the window resizes; its size is measured again each time, and as its content changes. Measured
// before it paints.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * The side of its anchor the card opens on, and the most it may be tall (null: as tall as it is); a
 * floating card's place in the window, `at` (null: a row's card, placed by its row's box): below its
 * link by its top, above it by its foot, so the edge by the link stays there however tall the card
 * grows or shrinks as the board changes.
 */
export type Placement = { side: "below" | "above"; cap: number | null; at: { left: number } & ({ top: number } | { bottom: number }) | null };

/** Spread `ref` on the card. `link`: the link it floats by; null: the card's parent is its row's box. */
export function useCardPlacement(link: HTMLElement | null): { ref: RefObject<HTMLDivElement | null>; placement: Placement } {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement>(UNMEASURED);
  /** Places a floating card by its link and its size as they are now; nothing for a row's card. */
  const follow = useCallback(() => {
    const card = ref.current;
    // why: the ref's type only; the card is mounted as this runs.
    if (link === null || card === null) return;
    const next = floatingPlacement(link.getBoundingClientRect(), sizeOf(card));
    setPlacement((current) => (samePlacement(current, next) ? current : next));
  }, [link]);
  // why layout effects: the card's size and the room around its anchor are the browser's to measure, and the card must not paint where it doesn't fit.
  useLayoutEffect(() => {
    const card = ref.current;
    const row = card?.parentElement ?? null;
    if (link === null && card !== null && row !== null) setPlacement(rowPlacement(row, card));
  }, [link]);
  // why after every render: the card's content, and so its size, changes as the board does.
  useLayoutEffect(follow);
  useEffect(() => {
    if (link === null) return;
    // why capturing: a scroll doesn't bubble, and the link moves with whichever of its ancestors scrolls.
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [link, follow]);
  return { ref, placement };
}

// ------------------------------------------------------------------ layer 2

const UNMEASURED: Placement = { side: "below", cap: null, at: null };

/** A floating card's size now: its width, and its whole content's height, which its body scrolls when capped. */
function sizeOf(card: HTMLElement): { height: number; width: number } {
  // why the body's: a capped card is as tall as its cap, and only the body's scroll height is all of it.
  const body = card.querySelector<HTMLElement>(".rmi-card-body") ?? card;
  return { height: body.scrollHeight, width: card.offsetWidth };
}

const samePlacement = (a: Placement, b: Placement): boolean => a.side === b.side && a.cap === b.cap && JSON.stringify(a.at) === JSON.stringify(b.at);

/** The gap between the card and its anchor (hover-card.css `.rmi-card`). */
const GAP = 4;
/** The least a capped card is tall: its title, its status and the start of what follows. */
const MIN_CAP = 96;
/** The least room a floating card keeps from the window's sides. */
const MARGIN = 8;

type Edges = { top: number; bottom: number };

/** A row's card, kept inside every ancestor of the row that clips. */
const rowPlacement = (row: Element, card: HTMLElement): Placement => ({ ...sideOf(row.getBoundingClientRect(), card.scrollHeight, visibleBounds(row)), at: null });

/** A link's card of `size`, against the window as it is now: on the side of the link with room, from the link's left edge, kept off the window's right edge. why the size: only to pick the side and the cap. */
function floatingPlacement(link: DOMRect, size: { height: number; width: number }): Placement {
  const { side, cap } = sideOf(link, size.height, { top: 0, bottom: window.innerHeight });
  const left = Math.max(MARGIN, Math.min(link.left, window.innerWidth - size.width - MARGIN));
  return { side, cap, at: side === "below" ? { left, top: link.bottom + GAP } : { left, bottom: window.innerHeight - link.top + GAP } };
}

/** Below when the card fits under its anchor; above when it doesn't and there is more room above; capped to its side's room when it fits on neither. */
function sideOf(anchor: Edges, height: number, bounds: Edges): Omit<Placement, "at"> {
  const below = bounds.bottom - anchor.bottom - GAP;
  const above = anchor.top - bounds.top - GAP;
  if (height <= below) return { side: "below", cap: null };
  if (above > below) return { side: "above", cap: height <= above ? null : Math.max(above, MIN_CAP) };
  return { side: "below", cap: Math.max(below, MIN_CAP) };
}

/** The part of the window `el` can be seen in: the window, cut by every ancestor that clips what overflows it, as the panel the board scrolls in does. */
function visibleBounds(el: Element): Edges {
  let bounds: Edges = { top: 0, bottom: window.innerHeight };
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    if (getComputedStyle(at).overflowY === "visible") continue;
    const { top, bottom } = at.getBoundingClientRect();
    bounds = { top: Math.max(bounds.top, top), bottom: Math.min(bounds.bottom, bottom) };
  }
  return bounds;
}

// Where a hover card goes, so it is never cut off: under its anchor when it fits there, else above it
// when there is more room above, and capped to the room on its side, scrolling inside, when it fits
// on neither. A row's card sits in the row's box and keeps inside the panel the board scrolls in; a
// link's card floats, fixed, against the window, by the link's box, so the message list it sits in
// clips none of it, on whichever side of the link has room (chat-links/card/floating-placement.ts
// follows it), until the link can't be seen. Measured before it paints.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The side of its anchor a card opens on, and the most it may be tall (null: as tall as it is). */
export type Side = { side: "below" | "above"; cap: number | null };

/** A floating card's side, and its place in the window: below its link by its top, above it by its foot, so the edge by the link stays there however tall the card grows or shrinks as the board changes. */
export type FloatingPlacement = Side & { at: { left: number } & ({ top: number } | { bottom: number }) };

/** A row's card: spread `ref` on the card, whose parent is its row's box. */
export function useRowPlacement(): { ref: RefObject<HTMLDivElement | null>; placement: Side } {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Side>(UNMEASURED);
  // why a layout effect: the card's size and the room around its row are the browser's to measure, and the card must not paint where it doesn't fit.
  useLayoutEffect(() => {
    const card = ref.current;
    // why: the types only; the card, in its row's box, is mounted as this runs.
    if (card === null || card.parentElement === null) return;
    setPlacement(rowPlacement(card.parentElement, card));
  }, []);
  return { ref, placement };
}

/**
 * A row's card that follows its row while it shows: placed again as anything holding the row
 * scrolls or the window resizes, and put away (`lost`) once the row can't be seen in the panel. Spread
 * `ref` on the card, whose parent is its row's box, and `body` on its body, which scrolls when capped.
 * why the body's height: a capped card is as tall as its cap, and only its body's scroll height is
 * all of it.
 */
export function useFollowingRowPlacement(lost: () => void): { ref: RefObject<HTMLDivElement | null>; body: RefObject<HTMLDivElement | null>; placement: Side } {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Side>(UNMEASURED);
  const follow = useCallback(() => {
    const row = ref.current?.parentElement;
    // why: the refs' types only; the card, in its row's box, is mounted as this runs.
    if (row === null || row === undefined || body.current === null) return;
    const box = row.getBoundingClientRect();
    const bounds = visibleBounds(row);
    if (!overlaps(box, bounds)) return lost();
    const next = sideOf(box, body.current.scrollHeight, bounds);
    setPlacement((current) => (current.side === next.side && current.cap === next.cap ? current : next));
  }, [lost]);
  // why after every render, before paint: its content may change as the feed reads again, and it must not paint where it doesn't fit.
  useLayoutEffect(follow);
  useEffect(() => {
    // why the document, capturing: a scroll doesn't bubble, and the panel the row moves in is any element.
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [follow]);
  return { ref, body, placement };
}

/** Where a link's card of `size` floats by `link` as the page is now; null once the link can't be seen, scrolled out of the message list or the window. */
export function placeFloating(link: HTMLElement, size: { height: number; width: number }): FloatingPlacement | null {
  const box = link.getBoundingClientRect();
  return overlaps(box, visibleBounds(link)) ? floatingPlacement(box, size) : null;
}

// ------------------------------------------------------------------ layer 2

const UNMEASURED: Side = { side: "below", cap: null };

/** The gap between the card and its anchor (hover-card.css `.rmi-card`). */
const GAP = 4;
/** The least a capped card is tall: its title, its status and the start of what follows. */
const MIN_CAP = 96;
/** The least room a floating card keeps from the window's sides. */
const MARGIN = 8;

type Edges = { top: number; bottom: number };

/** A row's card, kept inside every ancestor of the row that clips. */
const rowPlacement = (row: Element, card: HTMLElement): Side => sideOf(row.getBoundingClientRect(), card.scrollHeight, visibleBounds(row));

/** A link's card of `size`, against the window as it is now: on the side of the link with room, from the link's left edge, kept off the window's right edge. why the size: only to pick the side and the cap. */
function floatingPlacement(link: DOMRect, size: { height: number; width: number }): FloatingPlacement {
  const { side, cap } = sideOf(link, size.height, { top: 0, bottom: window.innerHeight });
  const left = Math.max(MARGIN, Math.min(link.left, window.innerWidth - size.width - MARGIN));
  return { side, cap, at: side === "below" ? { left, top: link.bottom + GAP } : { left, bottom: window.innerHeight - link.top + GAP } };
}

/** Below when the card fits under its anchor; above when it doesn't and there is more room above; capped to its side's room when it fits on neither. */
function sideOf(anchor: Edges, height: number, bounds: Edges): Side {
  const below = bounds.bottom - anchor.bottom - GAP;
  const above = anchor.top - bounds.top - GAP;
  if (height <= below) return { side: "below", cap: null };
  if (above > below) return { side: "above", cap: height <= above ? null : Math.max(above, MIN_CAP) };
  return { side: "below", cap: Math.max(below, MIN_CAP) };
}

/** Whether `box` reaches into `bounds`, touching its edge included. */
const overlaps = (box: Edges, bounds: Edges): boolean => box.bottom >= bounds.top && box.top <= bounds.bottom;

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

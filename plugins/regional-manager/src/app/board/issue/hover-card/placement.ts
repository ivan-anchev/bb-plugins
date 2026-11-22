// Where a row's hover card goes, so it is never cut off by the panel it scrolls in: under its row
// when it fits there, else above it when there is more room above, and capped to the room on its
// side, scrolling inside, when it fits on neither. Measured as the card mounts, before it paints.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The side of its row the card opens on, and the most it may be tall (null: as tall as it is). */
export type Placement = { side: "below" | "above"; cap: number | null };

/** Spread `ref` on the card, whose parent is its row's box; `placement` is where it goes. */
export function useCardPlacement(): { ref: RefObject<HTMLDivElement | null>; placement: Placement } {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement>(UNMEASURED);
  // why a layout effect: the card's height and the panel's edges are the browser's to measure, and the card must not paint where it doesn't fit.
  useLayoutEffect(() => {
    const card = ref.current;
    const row = card?.parentElement ?? null;
    // why: the ref's type only; the card is mounted in its row's box as this runs.
    if (card === null || row === null) return;
    setPlacement(placementOf(row.getBoundingClientRect(), card.scrollHeight, visibleBounds(row)));
  }, []);
  return { ref, placement };
}

// ------------------------------------------------------------------ layer 2

const UNMEASURED: Placement = { side: "below", cap: null };

/** The gap between the card and its row (hover-card.css `.rmi-card`). */
const GAP = 4;
/** The least a capped card is tall: its title, its status and the start of what follows. */
const MIN_CAP = 96;

type Edges = { top: number; bottom: number };

/** Below when the card fits under its row; above when it doesn't and there is more room above; capped to its side's room when it fits on neither. */
function placementOf(row: Edges, height: number, bounds: Edges): Placement {
  const below = bounds.bottom - row.bottom - GAP;
  const above = row.top - bounds.top - GAP;
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

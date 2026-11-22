// Where an issue link's card floats (board/issue/hover-card/placement.ts says where): it follows the
// link, on whichever side has room, as anything holding it scrolls or the window resizes, and its
// size is measured again each time, and as its content changes. Once the link can't be seen, its card
// goes: a card by nothing on screen would hold a tab stop and bb's Escape for a link the user can't
// see. Measured before it paints.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { placeFloating, type FloatingPlacement } from "../../board/issue/hover-card/placement.ts";

/** Spread `ref` on the card and `body` on its body, which scrolls when capped. `lost` puts the card away once its link can't be seen. */
export function useFloatingPlacement(link: HTMLAnchorElement, lost: () => void): { ref: RefObject<HTMLDivElement | null>; body: RefObject<HTMLDivElement | null>; placement: FloatingPlacement } {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<FloatingPlacement>(UNMEASURED);
  /** Places the card by its link and its size as they are now, or puts it away once its link can't be seen. */
  const follow = useCallback(() => {
    const card = ref.current;
    // why: the refs' types only; the card is mounted as this runs.
    if (card === null || body.current === null) return;
    // why the body's height: a capped card is as tall as its cap, and only its body's scroll height is all of it.
    const next = placeFloating(link, { height: body.current.scrollHeight, width: card.offsetWidth });
    if (next === null) return lost();
    setPlacement((current) => (samePlacement(current, next) ? current : next));
  }, [link, lost]);
  // why after every render, before paint: the card's content, and so its size, changes as the board does, and it must not paint where it doesn't fit.
  useLayoutEffect(follow);
  useEffect(() => {
    // why capturing: a scroll doesn't bubble, and the link moves with whichever of its ancestors scrolls.
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [follow]);
  return { ref, body, placement };
}

// ------------------------------------------------------------------ layer 2

/** Before the first measure, which comes before the card paints. */
const UNMEASURED: FloatingPlacement = { side: "below", cap: null, at: { left: 0, top: 0 } };

const samePlacement = (a: FloatingPlacement, b: FloatingPlacement): boolean => a.side === b.side && a.cap === b.cap && JSON.stringify(a.at) === JSON.stringify(b.at);

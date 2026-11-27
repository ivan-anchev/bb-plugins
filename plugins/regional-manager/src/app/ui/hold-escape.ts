// While a draft is open, Esc never leaves the page, wherever focus is. bb's own Esc leaves the page,
// and the draft with it; it skips an event whose default was prevented. Adapted from pr-reviews
// (src/app/ui/hold-escape.ts), since plugins can't import each other.
import { useEffect, useRef } from "react";

/** Stops every Esc that reaches `target` from reaching bb, until released. Holds stack. */
function holdEscape(target: EventTarget): () => void {
  const listener = (event: Event) => {
    if ("key" in event && event.key === "Escape") event.preventDefault();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}

// why the document, bubbling: everything on the page acts on the Esc first, and bb's, on the
// window, comes after.
/** Holds Esc while `held`. */
export function useHoldEscape(held: boolean): void {
  useEffect(() => (held ? holdEscape(document) : undefined), [held]);
}

/**
 * While `active`, Escape anywhere calls `close`, and nothing else of bb's acts on the press that
 * closed it. For what Escape puts away wherever focus is: a hover card, a tooltip.
 */
export function useEscapeToClose(active: boolean, close: () => void): void {
  const closing = useRef(close);
  closing.current = close;
  useEffect(() => {
    if (!active) return;
    // why the window, capturing: it runs before every other listener. bb's side panel, an overlay on
    // a narrow window, dismisses itself on an Escape it sees at the document while capturing, unless
    // its default was prevented; bb's page-level Escape, on the window, skips one too. So the card
    // goes and the panel stays.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closing.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);
}

// While a box is open, Esc never leaves the PR page, wherever focus is: in the box, or on the page
// after a click outside it. bb's own Esc leaves the page, and the draft with it; it skips an event
// whose default was prevented (spike §4).
import { useEffect } from "react";

/**
 * Stops every Esc that reaches `target` from reaching bb, until released. Holds stack: each box
 * holds its own, so the page is held while any box is open.
 */
export function holdEscape(target: EventTarget): () => void {
  const listener = (event: Event) => {
    if ("key" in event && event.key === "Escape") event.preventDefault();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}

// why the document, bubbling: everything on the page acts on the Esc first (the box's own keys, a
// menu, whose Radix layer skips an Esc already prevented), and bb's, on the window, comes after.
/** Holds Esc while the calling box is open. */
export function useHoldEscape(): void {
  useEffect(() => holdEscape(document), []);
}

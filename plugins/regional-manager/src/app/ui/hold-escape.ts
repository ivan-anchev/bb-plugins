// While a draft is open, Esc never leaves the page, wherever focus is. bb's own Esc leaves the page,
// and the draft with it; it skips an event whose default was prevented. Adapted from pr-reviews
// (src/app/ui/hold-escape.ts), since plugins can't import each other.
import { useEffect } from "react";

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

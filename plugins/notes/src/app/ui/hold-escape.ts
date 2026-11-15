// While the Spotlight is open, Esc never leaves the page under it, wherever focus is. bb's own Esc
// leaves the page; it skips an event whose default was prevented. Copied from pr-reviews
// (src/app/ui/hold-escape.ts): every plugin installs standalone.
import { useEffect } from "react";

/** Stops every Esc that reaches `target` from reaching bb, until released. */
function holdEscape(target: EventTarget): () => void {
  const listener = (event: Event) => {
    if ("key" in event && event.key === "Escape") event.preventDefault();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}

// why the document, bubbling: everything on the page acts on the Esc first (the dialog's own
// dismiss, which skips an Esc already prevented), and bb's, on the window, comes after.
/** Holds Esc while `held`. */
export function useHoldEscape(held: boolean): void {
  useEffect(() => (held ? holdEscape(document) : undefined), [held]);
}

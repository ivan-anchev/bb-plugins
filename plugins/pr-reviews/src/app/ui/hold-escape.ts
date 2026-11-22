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

/** Holds Esc while the calling box is open and `held`. */
export function useHoldEscape(held: boolean): void {
  useEffect(() => (held ? holdEscape(document) : undefined), [held]);
}

import { useEffect } from "react";

function holdEscape(target: EventTarget): () => void {
  const listener = (event: Event) => {
    if ("key" in event && event.key === "Escape") event.preventDefault();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}

/** Holds Esc while `held`. */
export function useHoldEscape(held: boolean): void {
  useEffect(() => (held ? holdEscape(document) : undefined), [held]);
}

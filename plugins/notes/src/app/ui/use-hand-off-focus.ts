import { useLayoutEffect, type RefObject } from "react";

/**
 * When `element` leaves the page while it holds focus, focus moves to `fallback` instead of falling
 * to the page body: a row deleted from its own Delete button, a footer that leaves with the picks.
 * why a layout effect's cleanup: React runs it before it removes the element, so the element still
 * knows it has focus.
 */
export function useHandOffFocus(element: RefObject<HTMLElement | null>, fallback: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const node = element.current!;
    return () => {
      if (node.contains(document.activeElement)) fallback.current?.focus();
    };
  }, [element, fallback]);
}

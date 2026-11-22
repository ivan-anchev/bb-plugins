import { useLayoutEffect, useRef, type FocusEvent, type RefObject } from "react";

/**
 * Spread on the card's body. The body takes focus an update took while it still shows, the card once
 * it hides. Focus that left the body is never moved. It looks as its component renders, so whatever
 * changes the body's content must render that component.
 */
export function useFocusKept(): { ref: RefObject<HTMLDivElement | null>; onFocus(e: FocusEvent): void; onBlur(e: FocusEvent): void } {
  const ref = useRef<HTMLDivElement>(null);
  const holder = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const held = holder.current;
    const body = ref.current;
    if (held === null || body === null || (held.isConnected && held.checkVisibility())) return;
    (body.checkVisibility() ? body : body.closest<HTMLElement>(".as-card"))?.focus();
  });
  return {
    ref,
    onFocus: (e) => {
      holder.current = e.target;
    },
    onBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) holder.current = null;
    },
  };
}

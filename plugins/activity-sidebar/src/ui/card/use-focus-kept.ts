// Focus in the card's body stays in the card when an update takes what it is on: a fold pressed, a fold
// the agent's next step makes needless, a Retry that worked, a subthread gone, or the plan going and
// leaving the body with nothing to show (app.css hides it then).
import { useLayoutEffect, useRef, type FocusEvent, type RefObject } from "react";

/**
 * Spread on the card's body. The body takes focus an update took while it still shows, the card once
 * it hides. Focus that left the body is never moved. It looks as its component renders, so whatever
 * changes the body's content must render that component.
 */
export function useFocusKept(): { ref: RefObject<HTMLDivElement | null>; onFocus(e: FocusEvent): void; onBlur(e: FocusEvent): void } {
  const ref = useRef<HTMLDivElement>(null);
  /** What has focus in the body, the body included; null while focus is elsewhere. */
  const holder = useRef<Element | null>(null);
  // why: React hears no blur while it commits, and the browser blurs a hidden element only later, so a
  // holder gone from the page or hidden is one an update took.
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

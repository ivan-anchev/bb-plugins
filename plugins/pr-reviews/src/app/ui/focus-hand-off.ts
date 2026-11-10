// Focus that moves from a region as it unmounts to the control that replaces it, so focus never
// drops to the page body (REVIEW.md).
import { useMemo, type RefCallback } from "react";

/** `from` on the region that leaves, `to` on the element that takes its focus. */
export type FocusHandOff = { from: RefCallback<HTMLElement>; to: RefCallback<HTMLElement> };

// why ref callbacks: React detaches a ref before it removes the element, so `from`'s cleanup still
// sees whether the region holds focus, and attaches one after it inserts the element, so `to` can
// take that focus in the same commit. Both are stable, so neither runs again on a re-render.
export function useFocusHandOff(): FocusHandOff {
  return useMemo(() => {
    let handingOff = false;
    return {
      from: (region) => {
        if (region === null) return;
        return () => {
          handingOff = region.contains(document.activeElement);
        };
      },
      to: (target) => {
        if (target === null || !handingOff) return;
        handingOff = false;
        target.focus();
      },
    };
  }, []);
}

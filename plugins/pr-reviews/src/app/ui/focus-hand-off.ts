import { useMemo, type RefCallback } from "react";

/** `from` on the region that leaves, `to` on the element that takes its focus. */
export type FocusHandOff = { from: RefCallback<HTMLElement>; to: RefCallback<HTMLElement> };

export function useFocusHandOff(): FocusHandOff {
  return useMemo(() => {
    let handingOff = false;
    return {
      from: (region) => {
        if (region === null) return;
        return () => {
          if (region.contains(document.activeElement)) handingOff = true;
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

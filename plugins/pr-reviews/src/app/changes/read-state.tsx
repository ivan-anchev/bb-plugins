// The Changes tab's content region before the diff is read, loading or failed, and the hand-off of
// its focus to the diff pane that replaces it, so focus never drops to the page (REVIEW.md).
import { useMemo, type ReactNode, type Ref, type RefCallback } from "react";

type FocusHandOff = { from: RefCallback<HTMLElement>; to: RefCallback<HTMLElement> };

/** The tab's one tab stop for its content while there is no tree and diff yet: they bring their own. */
export function ReadState({ ref, children }: { ref: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Changes"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}

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

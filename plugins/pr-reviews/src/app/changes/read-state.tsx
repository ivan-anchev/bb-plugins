// The Changes tab's content region before the diff is read, loading or failed. Its focus passes to
// the diff pane that replaces it (useFocusHandOff).
import type { ReactNode, Ref } from "react";

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

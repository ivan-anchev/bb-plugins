// The type every guide page shares: its title and its body prose.
import type { ReactNode, Ref } from "react";

// The body type, and the same capped at a reading measure for a step's narrower story column.
export const PROSE_TYPE = "text-sm leading-[22px]";
export const PROSE = `max-w-[68ch] ${PROSE_TYPE}`;

// tabIndex -1: the walkthrough moves focus here when a move removes the focused element, but the
// title is not a tab stop and draws no focus ring.
export function PageTitle({ ref, children }: { ref: Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <h2 ref={ref} tabIndex={-1} className="text-[21px] font-semibold leading-7 tracking-[-0.01em] text-balance outline-none">
      {children}
    </h2>
  );
}

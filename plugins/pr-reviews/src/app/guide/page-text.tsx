// The type every guide page shares: its title and its body prose.
import type { ReactNode, Ref } from "react";
import { READING_TYPE } from "../ui/prose.tsx";

// The body type capped at a reading measure, for a step's narrower story column.
export const PROSE = `max-w-[68ch] ${READING_TYPE}`;

// tabIndex -1: the walkthrough moves focus here when a move removes the focused element, but the
// title is not a tab stop and draws no focus ring.
export function PageTitle({ ref, children }: { ref: Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <h2 ref={ref} tabIndex={-1} className="text-xl font-semibold text-balance outline-none">
      {children}
    </h2>
  );
}

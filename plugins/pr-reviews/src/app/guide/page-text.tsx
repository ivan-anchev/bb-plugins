import type { ReactNode, Ref } from "react";
import { READING_TYPE } from "../ui/prose.tsx";

export const PROSE = `max-w-[68ch] ${READING_TYPE}`;

export function PageTitle({ ref, children }: { ref: Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <h2 ref={ref} tabIndex={-1} className="text-xl font-semibold text-balance outline-none">
      {children}
    </h2>
  );
}

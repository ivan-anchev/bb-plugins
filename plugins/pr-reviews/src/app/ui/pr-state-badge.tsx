// A PR's state badge, as Activity's sidebar draws it: the state's glyph and the badge's words in the
// state's color on a 10% wash of it. A row's badge carries the PR's number; the header's, and a
// state menu's, carry the state's name. Decorative: whatever holds it says the state in words.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrState } from "../../contract.ts";
import { STATE_TILES } from "../page/pr-header.tsx";

const SIZES = {
  row: { box: "h-4 gap-0.5 rounded-sm px-1 text-[11px] leading-3.5", icon: "size-2.75" },
  header: { box: "h-6 gap-1 rounded-md px-1.5 text-xs leading-4", icon: "size-3.5" },
} as const;

type PrStateBadgeProps = {
  state: PrState;
  size?: keyof typeof SIZES;
  /** Extra classes, such as a trigger's hover wash. */
  className?: string;
  children: ReactNode;
};

export function PrStateBadge({ state, size = "row", className = "", children }: PrStateBadgeProps) {
  const { icon, color } = STATE_TILES[state];
  const { box, icon: glyph } = SIZES[size];
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center bg-current/10 font-medium tabular-nums ${box} ${color} ${className}`}>
      <Icon name={icon} className={`${glyph} shrink-0`} />
      {children}
    </span>
  );
}

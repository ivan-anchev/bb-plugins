// A PR's state badge, as Activity's sidebar draws it: the state's glyph and the PR's number in the
// state's color on a 10% wash of it. Decorative: its row says the state in words.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrState } from "../../contract.ts";
import { STATE_TILES } from "../page/pr-header.tsx";

export function PrStateBadge({ state, number }: { state: PrState; number: number }) {
  const { icon, color } = STATE_TILES[state];
  return (
    <span
      aria-hidden
      className={`inline-flex h-4 shrink-0 items-center gap-0.5 rounded-sm bg-current/10 px-1 text-[11px] leading-3.5 font-medium tabular-nums ${color}`}
    >
      <Icon name={icon} className="size-2.75 shrink-0" />
      {number}
    </span>
  );
}

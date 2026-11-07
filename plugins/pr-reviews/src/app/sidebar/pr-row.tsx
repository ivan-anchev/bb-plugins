// One open PR in the sidebar: number and title, then author, last update and review state.
import type { PrRow, ReviewState } from "../../contract.ts";
import { timeAgo } from "../relative-time.ts";

const REVIEW_LABEL: Record<ReviewState["kind"], string> = { none: "No guide" };

type PrRowButtonProps = { row: PrRow; current: boolean; onClick(): void };

export function PrRowButton({ row, current, onClick }: PrRowButtonProps) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className="grid w-full cursor-pointer gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[current=page]:bg-state-active"
    >
      <span className="line-clamp-2 text-[13px] leading-[18px]">
        <span className="mr-1 font-medium tabular-nums text-muted-foreground">#{row.number}</span>
        {row.title}
      </span>
      <span className="flex min-w-0 gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{row.author}</span>
        <span title={new Date(row.updatedAt).toLocaleString()}>· {timeAgo(row.updatedAt, Date.now())}</span>
        <span className="ml-auto">{REVIEW_LABEL[row.review.kind]}</span>
      </span>
    </button>
  );
}

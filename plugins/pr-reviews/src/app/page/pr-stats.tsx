// The PR header's stats strip, divided by hairlines: files, and `+N −N` with its diffstat. The PR's
// checks are in the Summary tab's side panel.
import type { ReactNode } from "react";
import type { PrDetail } from "../../contract.ts";
import { diffBlocks, type DiffBlock } from "./header-stats.ts";

export function PrStats({ pr }: { pr: PrDetail }) {
  return (
    <p className="overflow-hidden text-xs leading-5 whitespace-nowrap text-muted-foreground">
      {/* -ml-[21px] pulls each line's first hairline (and its margins) out of view, so a wrapped
          strip never starts or ends a line with a divider. */}
      <span className="-ml-[21px] flex flex-wrap items-center gap-y-0.5">
        <Stat>
          {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
        </Stat>
        <Stat>
          <LinesStat additions={pr.additions} deletions={pr.deletions} />
        </Stat>
      </span>
    </p>
  );
}

// Each stat leads with a hairline: 10px, 1px, 10px.
function Stat({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center tabular-nums before:mx-2.5 before:h-3 before:w-px before:bg-border">{children}</span>;
}

const BLOCK_COLORS = { added: "bg-diff-added", removed: "bg-diff-removed", empty: "bg-muted" } as const satisfies Record<DiffBlock, string>;

function LinesStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>
        <LineCount sign="+" count={additions} color="text-diff-added" /> <LineCount sign="−" count={deletions} color="text-diff-removed" />
      </span>
      <span aria-hidden className="inline-flex gap-0.5">
        {diffBlocks(additions, deletions).map((block, index) => (
          <span key={index} className={`size-[7px] rounded-[2px] ${BLOCK_COLORS[block]}`} />
        ))}
      </span>
    </span>
  );
}

// A zero count is not a signal, so it gets no color.
function LineCount({ sign, count, color }: { sign: string; count: number; color: string }) {
  return (
    <span className={count === 0 ? "text-subtle-foreground" : color}>
      {sign}
      {count}
    </span>
  );
}

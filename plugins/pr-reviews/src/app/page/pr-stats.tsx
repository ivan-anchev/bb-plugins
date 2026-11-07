// The PR header's stats strip, divided by hairlines: files, `+N −N` with its diffstat, and the CI
// checks verdict. A count only: the header runs no checks and links to none.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PrDetail } from "../../contract.ts";
import { checksVerdict, diffBlocks, type ChecksTone, type ChecksVerdict, type DiffBlock } from "./header-stats.ts";

export function PrStats({ pr }: { pr: PrDetail }) {
  const verdict = checksVerdict(pr.checks);
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
        {verdict !== null && (
          <Stat>
            <ChecksStat verdict={verdict} />
          </Stat>
        )}
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

const TONE_ICONS = {
  failing: { name: "CircleX", color: "text-destructive-text" },
  pending: { name: "Clock", color: "text-muted-foreground" },
  passing: { name: "CircleCheck", color: "text-success-foreground" },
} as const satisfies Record<ChecksTone, { name: string; color: string }>;

// The glyph carries the tone; of the words, only a failing headline is colored.
function ChecksStat({ verdict: { tone, headline, rest } }: { verdict: ChecksVerdict }) {
  const icon = TONE_ICONS[tone];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={icon.name} className={`size-3.5 shrink-0 ${icon.color}`} aria-hidden />
      <span>
        <span className={tone === "failing" ? "text-destructive-text" : undefined}>{headline}</span>
        {rest.map((part) => ` · ${part}`).join("")}
      </span>
    </span>
  );
}

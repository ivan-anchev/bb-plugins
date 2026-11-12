// A sidebar row: one 28px line of author avatar, title, and a trailing status icon for a merged,
// closed or draft PR. The repo name shows on hover, keyboard focus and the open row. A listed row
// may carry one attention dot on its avatar; a stack-mate listed elsewhere is a dim, shorter row
// that says where it is listed. The words a screen reader needs ride along out of sight.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { InboxPr, StackPosition } from "../../contract.ts";
import { STATE_TILES } from "../page/pr-header.tsx";
import { ATTENTION } from "../page/status-glyph.tsx";
import { Avatar } from "../ui/avatar.tsx";
import type { Attention } from "./attention.ts";
import { SECTION_TEXT } from "./section-text.ts";

type RowProps = { pr: InboxPr; current: boolean; onOpen(): void };

const ATTENTION_LOOK = {
  "ci-failing": { label: "CI failing", color: "text-destructive-text" },
  "changes-requested": { label: "Changes requested", color: ATTENTION },
  "new-activity": { label: "New activity", color: "text-foreground" },
} as const satisfies Record<Attention, { label: string; color: string }>;

/** A PR listed in the section: `stack` is its place when it is the only one of its stack here. */
export function ListedRow({ pr, current, onOpen, attention, stack }: RowProps & { attention: Attention | null; stack: StackPosition | null }) {
  const words = [stack === null ? null : `stacked PR ${stack.index} of ${stack.size}`, attention === null ? null : ATTENTION_LOOK[attention].label];
  return (
    <RowButton pr={pr} current={current} onOpen={onOpen} words={words} className="h-7">
      <span className="relative shrink-0">
        <Avatar login={pr.author} size={16} />
        {attention !== null && (
          <span aria-hidden className={`absolute -top-[3px] -right-[3px] size-[7px] rounded-full bg-current ring-2 ring-sidebar ${ATTENTION_LOOK[attention].color}`} />
        )}
      </span>
      <span className="truncate text-[13px] leading-[18px]">{pr.title}</span>
      <Trail pr={pr}>
        {stack !== null && (
          <span aria-hidden className="inline-flex items-center gap-[3px] text-[11px] leading-4 text-subtle-foreground tabular-nums">
            <Icon name="Layers" className="size-3" aria-hidden />
            {stack.index}/{stack.size}
          </span>
        )}
      </Trail>
    </RowButton>
  );
}

/** A stack-mate of the section's PRs that is listed in another section, or in none. */
export function StackMateRow({ pr, current, onOpen }: RowProps) {
  const where = pr.section === null ? "Not in your sections" : `In ${SECTION_TEXT[pr.section].title}`;
  const tag = pr.section === null ? null : SECTION_TEXT[pr.section].tag;
  return (
    <RowButton pr={pr} current={current} onOpen={onOpen} words={[where]} className="h-6">
      <span className="shrink-0 opacity-50">
        <Avatar login={pr.author} size={16} />
      </span>
      <span className="truncate text-xs leading-4 text-subtle-foreground group-hover/row:text-muted-foreground group-aria-[current=page]/row:text-muted-foreground">
        {pr.title}
      </span>
      <Trail pr={pr}>{tag !== null && <span aria-hidden className="text-[11px] leading-4 whitespace-nowrap text-subtle-foreground">{tag}</span>}</Trail>
    </RowButton>
  );
}

type RowButtonProps = RowProps & { words: (string | null)[]; className: string; children: ReactNode };

// The open row's click re-reads, as Refresh does; that is the caller's `onOpen`.
function RowButton({ pr, current, onOpen, words, className, children }: RowButtonProps) {
  const state = pr.state === "OPEN" ? null : STATE_TILES[pr.state].label;
  const said = words.filter((word) => word !== null);
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      title={[pr.title, `${pr.repo} #${pr.number} · ${pr.author}`, ...said].join("\n")}
      onClick={onOpen}
      className={`group/row grid w-full cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md pr-2 pl-2.5 text-left transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-state-active ${className}`}
    >
      {children}
      <span className="sr-only">, {[pr.author, pr.repo, ...said, state].filter((word) => word !== null).join(", ")}</span>
    </button>
  );
}

// The repo's name, then the row's own marks, then the status icon.
function Trail({ pr, children }: { pr: InboxPr; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="hidden max-w-[92px] truncate text-[11.5px] leading-4 text-subtle-foreground group-hover/row:block group-focus-visible/row:block group-aria-[current=page]/row:block"
      >
        {pr.repo.split("/")[1]}
      </span>
      {children}
      {pr.state !== "OPEN" && <Icon name={STATE_TILES[pr.state].icon} aria-hidden className={`size-3.5 shrink-0 ${STATE_TILES[pr.state].color}`} />}
    </span>
  );
}

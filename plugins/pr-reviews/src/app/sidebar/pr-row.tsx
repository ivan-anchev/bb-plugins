// A sidebar row: one 32px line of author avatar, title, and a trailing state badge with its
// number. The title is Activity's: muted at rest, firm on the open row and an attention
// row, fading where it doesn't fit and running to its end under the pointer. The repo name shows on
// hover, keyboard focus and the open row. A listed row may carry one attention dot on its avatar; a
// stack-mate listed elsewhere is a dim, shorter row that says where it is listed. The words a screen reader needs ride along out of sight.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { InboxPr, StackPosition } from "../../contract.ts";
import { STATE_TILES } from "../page/pr-header.tsx";
import { Avatar } from "../ui/avatar.tsx";
import { FadingTitle } from "../ui/fading-title.tsx";
import { PrStateBadge } from "../ui/pr-state-badge.tsx";
import type { Attention } from "./attention.ts";
import { SECTION_TEXT } from "./section-text.ts";

type RowProps = { pr: InboxPr; current: boolean; onOpen(): void };

// Activity's row title: quiet at rest, firm on the open row and on one that asks to be seen.
const TITLE = "text-[13px] leading-4.5";
const STRONG = "font-medium text-foreground";

const ATTENTION_LOOK = {
  "ci-failing": { label: "CI failing", color: "text-destructive-text" },
  "changes-requested": { label: "Changes requested", color: "text-attention" },
  "new-activity": { label: "New activity", color: "text-foreground" },
} as const satisfies Record<Attention, { label: string; color: string }>;

/** A PR listed in the section: `stack` is its place when it is the only one of its stack here. */
export function ListedRow({ pr, current, onOpen, attention, stack }: RowProps & { attention: Attention | null; stack: StackPosition | null }) {
  const words = [stack === null ? null : `stacked PR ${stack.index} of ${stack.size}`, attention === null ? null : ATTENTION_LOOK[attention].label];
  return (
    <RowButton pr={pr} current={current} onOpen={onOpen} words={words} className="h-8">
      <AttentionAvatar login={pr.author} attention={attention} ring="ring-sidebar" />
      <FadingTitle text={pr.title} className={`${TITLE} ${current || attention !== null ? STRONG : "text-muted-foreground"}`} />
      <Trail pr={pr}>
        {stack !== null && (
          <span aria-hidden className="inline-flex items-center gap-1 text-xs leading-4 text-subtle-foreground tabular-nums">
            <Icon name="Layers" className="size-3" aria-hidden />
            {stack.index}/{stack.size}
          </span>
        )}
      </Trail>
    </RowButton>
  );
}

/** The author's avatar with a row's attention dot, ringed in `ring`, the surface it sits on. */
export function AttentionAvatar({ login, attention, ring }: { login: string; attention: Attention | null; ring: string }) {
  return (
    <span className="relative shrink-0">
      <Avatar login={login} size={16} />
      {attention !== null && (
        <span aria-hidden className={`absolute -top-0.5 -right-0.5 size-2 rounded-full bg-current ring-2 ${ring} ${ATTENTION_LOOK[attention].color}`} />
      )}
    </span>
  );
}

/** The words a screen reader hears for a row's attention dot. */
export const attentionLabel = (attention: Attention) => ATTENTION_LOOK[attention].label;

/** A stack-mate of the section's PRs that is listed in another section, or in none. */
export function StackMateRow({ pr, current, onOpen }: RowProps) {
  const where = pr.section === null ? "Not in your sections" : `In ${SECTION_TEXT[pr.section].title}`;
  const tag = pr.section === null ? null : SECTION_TEXT[pr.section].tag;
  return (
    <RowButton pr={pr} current={current} onOpen={onOpen} words={[where]} className="h-7">
      <span className="shrink-0 opacity-50">
        <Avatar login={pr.author} size={16} />
      </span>
      <FadingTitle text={pr.title} className={`${TITLE} ${current ? STRONG : "text-subtle-foreground group-hover/row:text-muted-foreground"}`} />
      <Trail pr={pr}>{tag !== null && <span aria-hidden className="text-xs leading-4 whitespace-nowrap text-subtle-foreground">{tag}</span>}</Trail>
    </RowButton>
  );
}

type RowButtonProps = RowProps & { words: (string | null)[]; className: string; children: ReactNode };

// The open row's click re-reads, as Refresh does; that is the caller's `onOpen`.
function RowButton({ pr, current, onOpen, words, className, children }: RowButtonProps) {
  const state = STATE_TILES[pr.state].label;
  const said = words.filter((word) => word !== null);
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      title={[pr.title, `${pr.repo} #${pr.number} · ${pr.author}`, ...said].join("\n")}
      onClick={onOpen}
      className={`pr-reviews-title-scope group/row grid w-full cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md pr-2 pl-2.5 text-left transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-state-active ${className}`}
    >
      {children}
      <span className="sr-only">, {[pr.author, pr.repo, ...said, state].filter((word) => word !== null).join(", ")}</span>
    </button>
  );
}

// The repo's name, then the row's own marks, then the state badge.
function Trail({ pr, children }: { pr: InboxPr; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="hidden max-w-[92px] truncate text-xs leading-4 text-subtle-foreground group-hover/row:block group-focus-visible/row:block group-aria-[current=page]/row:block"
      >
        {pr.repo.split("/")[1]}
      </span>
      {children}
      <PrStateBadge state={pr.state} number={pr.number} />
    </span>
  );
}

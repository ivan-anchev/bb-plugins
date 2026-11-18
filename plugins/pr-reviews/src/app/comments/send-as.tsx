// The comment box's send row, drawn as bb's composer draws its own: Send as, a chip naming what the
// draft goes as (Ask, Comment, Review; box-actions.ts) that opens a menu of the others, as bb's
// model chip does; and the send button that sends it. A mode that can't send stays in the menu,
// disabled, its reason in place of what it does. With one mode, the chip is a label, not a menu.
import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRememberedState } from "../use-remembered-state.ts";
import { CodeReviewIcon } from "../ui/code-review-icon.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { descriptionOf, sendLabelOf, type GitHubActions, type SendOption, type Subject } from "./box-actions.ts";
import type { Action } from "./box-problems.ts";

// The mode the reader last picked, in any box: every box after opens on it, for the session.
const remembered = new Map<string, Action | null>();
const PICKED = "picked";

/** The mode the reader last picked (null: none yet), and `pick`, which remembers a new one. */
export function usePickedMode() {
  return useRememberedState(remembered, PICKED, null);
}

/**
 * For a button that opens a box to ask, or to write to GitHub: the box opens on Ask, or on the
 * reader's way to GitHub, Comment unless they last picked Review.
 */
export function pickForNextBox(to: "ask" | "github"): void {
  if (to === "ask") remembered.set(PICKED, "ask");
  else if (remembered.get(PICKED) !== "review") remembered.set(PICKED, "comment");
}

type SendAsProps = { subject: Subject; actions: GitHubActions; options: readonly SendOption[]; selected: Action; onPick(mode: Action): void };

export function SendAs({ subject, actions, options, selected, onPick }: SendAsProps) {
  const chip = (
    <>
      {ICONS[selected]}
      <span className="min-w-0 truncate">{sendLabelOf(subject, selected)}</span>
    </>
  );
  if (options.length === 1) return <span className={`${CHIP_CLASS} cursor-default`}>{chip}</span>;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label={`Send as: ${sendLabelOf(subject, selected)}`} className={`${CHIP_CLASS} ${CHIP_BUTTON_CLASS}`}>
          {chip}
          <Icon name="ChevronDown" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-72">
        <MenuRadioGroup value={selected} onValueChange={(value) => onPick(options.find(({ mode }) => mode === value)?.mode ?? selected)}>
          {options.map(({ mode, reason }) => (
            <MenuRadioItem key={mode} value={mode} disabled={reason !== null}>
              <span className="flex min-w-0 items-start gap-2">
                <span className="mt-px text-muted-foreground">{ICONS[mode]}</span>
                <span className="min-w-0">
                  <span className="block">{sendLabelOf(subject, mode)}</span>
                  <span className="block text-muted-foreground">{reason ?? descriptionOf(mode, actions)}</span>
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

// bb's model chip in its composer, class for class: a quiet ghost button, the choice and a chevron.
const CHIP_CLASS =
  "inline-flex h-8 w-fit max-w-full min-w-0 select-none items-center justify-start gap-1 whitespace-nowrap rounded-md px-1 text-xs leading-tight font-normal text-muted-foreground [&_[data-icon-root]]:pointer-events-none [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0";
const CHIP_BUTTON_CLASS =
  "cursor-pointer duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-state-active data-[state=open]:text-foreground data-[state=open]:hover:bg-state-active";

// 16px, as bb's composer and menus draw their icons.
const ICONS = {
  ask: <Icon name="SideChat" className="size-4 shrink-0" aria-hidden />,
  comment: <Icon name="GithubLogo" className="size-4 shrink-0" aria-hidden />,
  review: <CodeReviewIcon className="size-4 shrink-0" />,
} as const satisfies Record<Action, ReactNode>;

type SendButtonProps = {
  /** What it sends as, with its keys: its name and its tooltip. */
  label: string;
  sending: boolean;
  /** There is nothing it can send. */
  disabled: boolean;
  onSend(): void;
};

/**
 * bb's composer send button, class for class, and marked as bb marks it, so a theme that draws
 * bb's (a round one, in Zeron) draws this one too. An arrow; while the draft is going, a spinner
 * in its place, at full strength: busy, not unavailable.
 */
export function SendButton({ label, sending, disabled, onSend }: SendButtonProps) {
  return (
    <Tooltip content={label} placement="top-end">
      {() => (
        <button
          type="button"
          data-promptbox-submit-action=""
          aria-label={sending ? "Sending…" : label}
          aria-disabled={disabled || sending}
          aria-busy={sending}
          onClick={onSend}
          className={SEND_CLASS}
        >
          {sending ? <Spinner size="icon" tone="inherit" /> : <Icon name="ArrowUp" aria-hidden />}
        </button>
      )}
    </Tooltip>
  );
}

// why aria-disabled, not disabled: the button stays focusable, and still names what it would send as.
const SEND_CLASS =
  "inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-foreground px-2 text-xs font-medium text-background transition-colors duration-150 hover:bg-foreground/90 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:not-aria-busy:opacity-50 aria-disabled:hover:bg-foreground [&_[data-icon-root]]:pointer-events-none [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0";

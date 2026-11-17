// The comment box's send row: Send as, a segmented control (ui/segmented.tsx) of what the draft
// goes as (Ask, Comment, Review; box-actions.ts), and the round send button that sends it. Send as
// is the ARIA radio pattern: one tab stop, ← → move and pick, skipping the segments that can't send,
// which stay in place, aria-disabled, with their tooltip saying why. In a box under 470px wide the
// segments are icons alone: their names stay for screen readers, and the tooltip of one that can
// send shows its name.
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRememberedState } from "../use-remembered-state.ts";
import { CodeReviewIcon } from "../ui/code-review-icon.tsx";
import { SEGMENT_CLASS, SegmentThumb, TRACK_CLASS } from "../ui/segmented.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { steppedFrom, type Segment } from "./box-actions.ts";
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

type SendAsProps = { segments: readonly Segment[]; selected: Action; onPick(mode: Action): void };

export function SendAs({ segments, selected, onPick }: SendAsProps) {
  const track = useRef<HTMLDivElement>(null);
  const radioId = useId();
  const idOf = (mode: Action) => `${radioId}-${mode}`;
  // The radio keeps focus and picks as it goes. Handled here, the keys stay out of the diff's.
  const onKeyDown = (event: KeyboardEvent) => {
    const by = STEPS[event.key];
    if (by === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const to = steppedFrom(segments, selected, by);
    if (to === null) return;
    onPick(to);
    track.current!.querySelector<HTMLElement>(`#${CSS.escape(idOf(to))}`)!.focus();
  };
  return (
    <div ref={track} role="radiogroup" aria-label="Send as" className={TRACK_CLASS} onKeyDown={onKeyDown}>
      <SegmentThumb at={segments.findIndex(({ mode }) => mode === selected)} of={segments.length} />
      {segments.map(({ mode, reason }) => (
        // why the name only when narrow: beside the label it would only repeat it, and it would
        // cover the send button's tooltip while the radio has focus.
        <Tooltip key={mode} content={reason ?? LABELS[mode]} placement="top-end" popupClassName={reason === null ? "@min-[470px]:hidden" : ""}>
          {(describedBy) => (
            <button
              type="button"
              role="radio"
              id={idOf(mode)}
              aria-checked={mode === selected}
              aria-disabled={reason !== null}
              aria-describedby={reason === null ? undefined : describedBy}
              tabIndex={mode === selected ? 0 : -1}
              onClick={() => {
                if (reason === null) onPick(mode);
              }}
              className={RADIO_CLASS}
            >
              {ICONS[mode]}
              <span className="@max-[470px]:sr-only">{LABELS[mode]}</span>
            </button>
          )}
        </Tooltip>
      ))}
    </div>
  );
}

const RADIO_CLASS = `${SEGMENT_CLASS} h-6 flex-1 gap-1 @max-[470px]:px-1.5 aria-checked:text-foreground aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:text-muted-foreground`;

const ICON_CLASS = "size-3.5 shrink-0";

const ICONS = {
  ask: <Icon name="SideChat" className={ICON_CLASS} aria-hidden />,
  comment: <Icon name="GithubLogo" className={ICON_CLASS} aria-hidden />,
  review: <CodeReviewIcon className={ICON_CLASS} />,
} as const satisfies Record<Action, ReactNode>;

const LABELS = { ask: "Ask", comment: "Comment", review: "Review" } as const satisfies Record<Action, string>;

const STEPS: Partial<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

type SendButtonProps = {
  /** What it sends as, with its keys: its name and its tooltip. */
  label: string;
  sending: boolean;
  disabled: boolean;
  onSend(): void;
};

/** The round send button, an arrow; a spinner while the draft is going. */
export function SendButton({ label, sending, disabled, onSend }: SendButtonProps) {
  return (
    <Tooltip content={label} placement="top-end">
      {() => (
        <button type="button" aria-label={sending ? "Sending…" : label} aria-disabled={disabled} onClick={onSend} className={SEND_CLASS}>
          {sending ? <Spinner /> : <Icon name="ArrowUp" className="size-4" aria-hidden />}
        </button>
      )}
    </Tooltip>
  );
}

// The ring stands off by a pixel of the background, as a primary Button's does.
const SEND_CLASS =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-[background-color,scale] duration-150 ease-out hover:bg-primary/88 hover:duration-0 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

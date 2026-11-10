// A box to write something in and act on it: the textarea, the error of the last attempt, Cancel
// and the box's action. The owner keeps the draft, so it decides what survives a close or a send.
import { useEffect, useRef, type Ref, type RefObject } from "react";
import { Button } from "./button.tsx";
import { DESTRUCTIVE_TEXT_ON_MUTED } from "./destructive-text-on-muted.ts";
import { useHoldEscape } from "./hold-escape.ts";

type DraftBoxProps = {
  /** The box's element: the id a toggle's `aria-controls` names, and the ref its owner checks focus against. */
  id: string;
  ref?: Ref<HTMLDivElement>;
  /** The textarea, which takes focus when the box opens; its owner may read what it holds. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The textarea's accessible name. */
  label: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
  /** Esc in an empty box. A box with text keeps it, so a draft is never lost to Esc. */
  onEscapeEmpty(): void;
  onCancel(): void;
  error: string | null;
  /**
   * The primary button. `pending` keeps it focusable but inert while the last run is in flight.
   * `run` never rejects: its owner shows a failure as `error`.
   */
  action: { label: string; pending: boolean; run(): Promise<void> };
};

export function DraftBox({ id, ref, textareaRef, label, placeholder, value, onChange, onEscapeEmpty, onCancel, error, action }: DraftBoxProps) {
  // why an effect, not autoFocus: autoFocus loses to the button whose click opened the box (spike §5).
  useEffect(() => textareaRef.current!.focus(), [textareaRef]);
  useHoldEscape();
  // why a latch beside `pending`: `pending` arrives with the next render, so a quick second click
  // would run the action twice.
  const running = useRef(false);
  const run = () => {
    if (running.current) return;
    running.current = true;
    void action.run().finally(() => (running.current = false));
  };
  return (
    // why on the box, not the textarea: Esc is the box's wherever in it focus is, Cancel included.
    <div
      ref={ref}
      id={id}
      className="mt-1 grid gap-1.5"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // why here as well as the hold: an Esc that closes the box takes its hold with it before
        // the event gets that far, and bb's own Esc would leave the page.
        event.preventDefault();
        if (value === "") onEscapeEmpty();
      }}
    >
      <label htmlFor={`${id}-text`} className="sr-only">
        {label}
      </label>
      <textarea
        ref={textareaRef}
        id={`${id}-text`}
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-[52px] w-full resize-y rounded-md bg-background px-2.5 py-2 text-[13px] leading-[19px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-end gap-1.5">
        {error !== null && (
          <p role="alert" className={`mr-auto text-xs ${DESTRUCTIVE_TEXT_ON_MUTED}`}>
            {error}
          </p>
        )}
        <Button variant="ghost" size="small" onClick={onCancel}>
          Cancel
        </Button>
        {/* why aria-disabled while pending: a disabled button drops the focus a click on it gave,
            and a box gives focus back only from inside itself. */}
        <Button variant="primary" size="small" onClick={action.pending ? undefined : run} aria-disabled={action.pending} disabled={value.trim() === ""}>
          {action.label}
        </Button>
      </div>
    </div>
  );
}

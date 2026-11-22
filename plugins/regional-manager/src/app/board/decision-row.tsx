// A decision the regional manager put to the user with crew_ask_user, on an issue row's grid
// (issue/issue-row.tsx): a question glyph in the 30 slot, its id and question where a title sits.
// It sits under Needs you with a button for each option and a field for an answer in the user's own
// words, which the browser keeps until the board reads it answered (see answer-draft.ts). Answered, it
// leaves the board, and focus in it goes to the page; the question and its answer stay among its
// issue's feed (issue-tab/feed/decision-card.tsx).
import { useId, type KeyboardEvent } from "react";
import { MAX_ANSWER_CHARS, type OpenDecision } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { GrowingTextarea } from "../ui/growing-textarea.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { useStored } from "../ui/stored.ts";
import { answerDraftKeyOf, answerDraftSchema } from "./answer-draft.ts";
import { useAnswer } from "./use-answer.ts";

// why these sizes: an issue row's (issue/row/issue-row.css `.rmi-slot`, `.rmi-row`, `.rmi-row-id`), so the question lines up with the titles.
const ROW = "flex items-start rounded-lg";
const SLOT = "flex size-[30px] shrink-0 items-center justify-center";
const WORDS = "flex min-w-0 flex-1 flex-col pr-2 text-[13px] leading-[18px]";
const QUESTION = "py-1.5 text-pretty [overflow-wrap:anywhere]";
const ID = "mr-2 font-mono text-[12px] text-muted-foreground tabular-nums";

type DecisionRowProps = { coordinatorId: CoordinatorId; decision: OpenDecision };

/**
 * Choosing an option, or sending the field, answers it; the field keeps what was typed through a
 * failed send, beside its error, and holds bb's Esc while it has text.
 */
export function DecisionRow({ coordinatorId, decision }: DecisionRowProps) {
  const ids = useId();
  // What the user typed and hasn't sent, as the browser keeps it.
  const typed = useStored(localStorage, answerDraftKeyOf(coordinatorId, decision.id), answerDraftSchema);
  const draft = typed.value ?? "";
  // The answer sent, from the click until the board reads it back answered and the row leaves.
  const { sent, send, error } = useAnswer(coordinatorId, decision.id);
  useHoldEscape(draft.trim() !== "");

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter breaks the line, as in bb's composer.
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(draft);
  }

  // why aria-disabled, not disabled: a disabled button drops focus to the page while the answer sends.
  const busy = sent !== null;
  return (
    <div role="group" aria-labelledby={`${ids}-id ${ids}-question`} className={`${ROW} pb-2`}>
      <span className={`${SLOT} text-destructive-text`}>
        <QuestionGlyph />
      </span>
      <div className={`${WORDS} gap-2`}>
        <p className={`${QUESTION} font-medium text-foreground`}>
          <span id={`${ids}-id`} className={ID}>
            {decision.id}
          </span>
          <span id={`${ids}-question`}>{decision.question}</span>
        </p>
        {decision.options.length > 0 && (
          <ul aria-label="Options" className="flex flex-wrap gap-1.5">
            {decision.options.map((option) => (
              <li key={option} className="max-w-full">
                <Button variant="secondary" size="sm-wrap" aria-disabled={busy} onClick={() => send(option)}>
                  {option}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {/* why the heights: one line of the field stands as tall as Send beside it, at 14px text and at touch's 16px. */}
        <form
          className="flex items-end gap-1.5 [&_textarea]:min-h-9 max-sm:[&>button]:h-[2.375rem]"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <GrowingTextarea
            value={draft}
            onChange={(event) => typed.store(event.target.value === "" ? null : event.target.value)}
            onKeyDown={onKeyDown}
            readOnly={busy}
            maxLength={MAX_ANSWER_CHARS}
            aria-label={decision.options.length === 0 ? "Your answer" : "Your answer, in your own words"}
            placeholder={decision.options.length === 0 ? "Type your answer" : "Or type an answer"}
          />
          <Button type="submit" variant="default" aria-disabled={busy || draft.trim() === ""}>
            Send
          </Button>
        </form>
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            Sending your answer…
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-xs text-destructive-text">
            Could not send your answer: {error.message}
          </p>
        )}
      </div>
    </div>
  );
}

/** A circle around a question mark: what a decision is, in the slot an issue's status glyph takes. */
function QuestionGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  );
}

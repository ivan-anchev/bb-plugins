// A decision the regional manager put to the user with crew_ask_user, on an issue row's grid
// (issue/issue-row.tsx): a question glyph in the 30 slot, its id and question where a title sits.
// Open, it sits under Needs you with a button for each option and a field for an answer in the
// user's own words, which the browser keeps until it is sent (see answer-draft.ts). Answered, it
// sits under Done with the answer. Answering moves it there, and the board moves focus with it, to
// the answered row.
import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useEffect, useId, useState, type KeyboardEvent, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { MAX_ANSWER_CHARS, type Decision } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { GrowingTextarea } from "../ui/growing-textarea.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { useStored } from "../ui/stored.ts";
import { shortTime } from "../ui/time.ts";
import { answerDraftKeyOf, answerDraftSchema } from "./answer-draft.ts";

// why these sizes: an issue row's (issue-board.css `.rmi-slot`, `.rmi-line`, `.rmi-id`), so the question lines up with the titles.
const ROW = "flex items-start rounded-lg";
const SLOT = "flex size-[30px] shrink-0 items-center justify-center";
const WORDS = "flex min-w-0 flex-1 flex-col pr-2 text-[13px] leading-[18px]";
const QUESTION = "py-1.5 text-pretty [overflow-wrap:anywhere]";
const ID = "mr-1.5 font-mono text-[11px] text-subtle-foreground tabular-nums";

type DecisionRowProps = { ref: Ref<HTMLDivElement>; coordinatorId: CoordinatorId; decision: Decision };

export function DecisionRow({ ref, coordinatorId, decision }: DecisionRowProps) {
  const answer = decision.answer;
  const { value: typed, store } = useStored(localStorage, answerDraftKeyOf(coordinatorId, decision.id), answerDraftSchema);
  const answeredWithTyped = answer !== null && typed !== null;
  // why an effect: the typed answer lives in the browser, and an answered decision, by this answer
  // or from elsewhere, takes none again.
  useEffect(() => {
    if (answeredWithTyped) store(null);
  }, [answeredWithTyped, store]);
  if (answer === null) return <OpenDecision ref={ref} decision={decision} coordinatorId={coordinatorId} typed={typed ?? ""} onType={(text) => store(text === "" ? null : text)} />;
  return (
    // why the focus stop: an answer moves the row here, and focus with it, so it lands on what was answered.
    <div ref={ref} tabIndex={-1} className={`${ROW} pb-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring`}>
      <span className={`${SLOT} text-subtle-foreground`}>
        <QuestionGlyph />
      </span>
      <div className={WORDS}>
        <p className={`${QUESTION} text-subtle-foreground`}>
          <span className={ID}>{decision.id}</span>
          {decision.question}
        </p>
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <Icon name="CornerDownRight" aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            <span className="sr-only">You answered: </span>
            {answer.text}
            <span className="text-subtle-foreground">
              {" · "}
              <time dateTime={new Date(answer.at).toISOString()}>{shortTime(answer.at)}</time>
            </span>
          </span>
        </p>
      </div>
    </div>
  );
}

type OpenDecisionProps = DecisionRowProps & {
  /** What the user typed and hasn't sent, as the browser keeps it. */
  typed: string;
  onType(text: string): void;
};

/**
 * An open decision. Choosing an option, or sending the field, answers it; the field keeps what was
 * typed through a failed send, beside its error, and holds bb's Esc while it has text.
 */
function OpenDecision({ ref, coordinatorId, decision, typed: draft, onType }: OpenDecisionProps) {
  const ids = useId();
  const save = experimental_useRpcMutation({ contract, method: "answerDecision" });
  // The answer sent, from the click until the board reads it back and moves the row to Done.
  const [sent, setSent] = useState<string | null>(null);
  useHoldEscape(draft.trim() !== "");

  function send(text: string) {
    if (sent !== null || text.trim() === "") return;
    setSent(text);
    // why the catch: the hook's error shows under the field; the rejection carries nothing more.
    save.mutate({ coordinatorId, decisionId: decision.id, answer: text }).catch(() => setSent(null));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter breaks the line, as in bb's composer.
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(draft);
  }

  // why aria-disabled, not disabled: a disabled button drops focus to the page while the answer sends.
  const busy = sent !== null;
  return (
    <div ref={ref} role="group" aria-labelledby={`${ids}-id ${ids}-question`} className={`${ROW} pb-2`}>
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
            onChange={(event) => onType(event.target.value)}
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
        {save.error !== null && !busy && (
          <p role="alert" className="text-xs text-destructive-text">
            Could not send your answer: {save.error.message}
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

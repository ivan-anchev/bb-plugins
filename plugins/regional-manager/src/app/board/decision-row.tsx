// A decision the regional manager put to the user with crew_ask_user. Open, it sits under Needs
// you with its question, a button for each option and a field for an answer in the user's own
// words, which the browser keeps until it is sent (see answer-draft.ts). Answered, it sits under
// Done with the answer. Answering moves it there, and the board moves focus with it, to the
// answered row.
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

// why: the question and the answer line up past the id, as an issue's title does.
const ID_COLUMN = "grid grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5";
/** Lines under the question start where it starts: px-2, the 2.25rem id column and gap-x-2. */
const UNDER_QUESTION = "pl-[2.75rem]";

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
    <div ref={ref} tabIndex={-1} className={`${ID_COLUMN} rounded-md px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring`}>
      <span className="font-mono text-xs text-muted-foreground">{decision.id}</span>
      <span className="text-sm text-pretty">{decision.question}</span>
      <span className="col-start-2 flex items-start gap-1 text-xs">
        <Icon name="CornerDownRight" aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
          <span className="sr-only">You answered: </span>
          {answer.text}
        </span>
      </span>
      <span className="col-start-2 text-xs text-muted-foreground">
        Answered <time dateTime={new Date(answer.at).toISOString()}>{shortTime(answer.at)}</time>
      </span>
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
    <div ref={ref} role="group" aria-labelledby={`${ids}-id ${ids}-question`} className="flex flex-col gap-2 rounded-md px-2 py-1.5">
      <div className={ID_COLUMN}>
        <span id={`${ids}-id`} className="font-mono text-xs text-muted-foreground">
          {decision.id}
        </span>
        <p id={`${ids}-question`} className="text-sm text-pretty">
          {decision.question}
        </p>
      </div>
      <div className={`flex flex-col gap-2 ${UNDER_QUESTION}`}>
        {decision.options.length > 0 && (
          <ul aria-label="Options" className="flex flex-wrap gap-1.5">
            {decision.options.map((option) => (
              <li key={option} className="max-w-full">
                <Button variant="outline" size="sm-wrap" aria-disabled={busy} onClick={() => send(option)}>
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

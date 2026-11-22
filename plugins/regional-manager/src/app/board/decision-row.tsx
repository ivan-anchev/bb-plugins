import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { useId, useState, type KeyboardEvent } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import { MAX_ANSWER_CHARS, type OpenDecision } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { Button } from "../ui/button.tsx";
import { GrowingTextarea } from "../ui/growing-textarea.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { useStored } from "../ui/stored.ts";
import { answerDraftKeyOf, answerDraftSchema } from "./answer-draft.ts";

const ROW = "flex items-start rounded-lg";
const SLOT = "flex size-[30px] shrink-0 items-center justify-center";
const WORDS = "flex min-w-0 flex-1 flex-col pr-2 text-[13px] leading-[18px]";
const QUESTION = "py-1.5 text-pretty [overflow-wrap:anywhere]";
const ID = "mr-1.5 font-mono text-[11px] text-subtle-foreground tabular-nums";

type DecisionRowProps = { coordinatorId: CoordinatorId; decision: OpenDecision };

/**
 * Choosing an option, or sending the field, answers it; the field keeps what was typed through a
 * failed send, beside its error, and holds bb's Esc while it has text.
 */
export function DecisionRow({ coordinatorId, decision }: DecisionRowProps) {
  const ids = useId();
  const typed = useStored(localStorage, answerDraftKeyOf(coordinatorId, decision.id), answerDraftSchema);
  const draft = typed.value ?? "";
  const save = experimental_useRpcMutation({ contract, method: "answerDecision" });
  const [sent, setSent] = useState<string | null>(null);
  useHoldEscape(draft.trim() !== "");

  function send(text: string) {
    if (sent !== null || text.trim() === "") return;
    setSent(text);
    save.mutate({ coordinatorId, decisionId: decision.id, answer: text }).catch(() => setSent(null));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(draft);
  }

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
        {save.error !== null && !busy && (
          <p role="alert" className="text-xs text-destructive-text">
            Could not send your answer: {save.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

function QuestionGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  );
}

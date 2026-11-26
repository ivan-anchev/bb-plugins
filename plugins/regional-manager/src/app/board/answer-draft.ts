// An answer to an open decision that the user typed and hasn't sent, in its question's card in the
// issue's feed or on the Board's row. The browser keeps it, by regional manager and decision, so bb
// redrawing either (a resize across its mobile breakpoint remounts it) or a reload loses none of it,
// and both show the same words, until the board reads the decision answered, by it or from elsewhere.
import { useEffect, type KeyboardEvent } from "react";
import { z } from "zod";
import { MAX_ANSWER_CHARS, type Decision, type DecisionId } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { useHoldEscape } from "../ui/hold-escape.ts";
import { useStored, writeStored } from "../ui/stored.ts";

/**
 * The answer typed to one decision, from wherever its field shows (the question's card in its issue's
 * feed, the Board's row): what is typed, how to change it, and the field's keys, where Enter sends it
 * and Shift+Enter breaks the line, as in bb's composer. While it holds text, Esc never leaves the page
 * and loses it.
 */
export function useAnswerDraft(coordinatorId: CoordinatorId, decisionId: DecisionId, send: (text: string) => void) {
  const typed = useStored(localStorage, answerDraftKeyOf(coordinatorId, decisionId), answerDraftSchema);
  const draft = typed.value ?? "";
  useHoldEscape(draft.trim() !== "");
  return {
    draft,
    type: (text: string) => typed.store(text === "" ? null : text),
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      send(draft);
    },
  };
}

/** Where the browser keeps the answer typed to one decision. */
const answerDraftKeyOf = (coordinatorId: CoordinatorId, decisionId: DecisionId): string => `coordinator-decision-answer:${coordinatorId}:${decisionId}`;

/** An answer typed and not sent. why never empty: an emptied field keeps nothing stored. */
export const answerDraftSchema = z.string().min(1).max(MAX_ANSWER_CHARS);

/**
 * Drops what the browser keeps for each decision the board reads answered: an answered decision takes
 * no answer again. why here, not in the decision's row: answered, the row leaves the board, and a
 * failed send must keep what was typed, so only the board's read tells it landed.
 */
export function useAnsweredDraftsDropped(coordinatorId: CoordinatorId, decisions: readonly Decision[]): void {
  // why an effect: the drafts live in the browser's storage, outside React.
  useEffect(
    function dropAnsweredDrafts() {
      for (const { id, answer } of decisions) if (answer !== null) writeStored(localStorage, answerDraftKeyOf(coordinatorId, id), null);
    },
    [coordinatorId, decisions],
  );
}

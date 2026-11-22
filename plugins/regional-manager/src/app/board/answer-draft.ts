import { useEffect } from "react";
import { z } from "zod";
import { MAX_ANSWER_CHARS, type Decision, type DecisionId } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { writeStored } from "../ui/stored.ts";

/** Where the browser keeps the answer typed to one decision. */
export const answerDraftKeyOf = (coordinatorId: CoordinatorId, decisionId: DecisionId): string => `coordinator-decision-answer:${coordinatorId}:${decisionId}`;

/** An answer typed and not sent. why never empty: an emptied field keeps nothing stored. */
export const answerDraftSchema = z.string().min(1).max(MAX_ANSWER_CHARS);

/**
 * Drops what the browser keeps for each decision the board reads answered: an answered decision takes
 * no answer again. why here, not in the decision's row: answered, the row leaves the board, and a
 * failed send must keep what was typed, so only the board's read tells it landed.
 */
export function useAnsweredDraftsDropped(coordinatorId: CoordinatorId, decisions: readonly Decision[]): void {
  useEffect(
    function dropAnsweredDrafts() {
      for (const { id, answer } of decisions) if (answer !== null) writeStored(localStorage, answerDraftKeyOf(coordinatorId, id), null);
    },
    [coordinatorId, decisions],
  );
}

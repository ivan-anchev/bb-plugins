// An answer to an open decision that the user typed and hasn't sent. The browser keeps it, by
// Coordinator and decision, so bb redrawing the board (a resize across its mobile breakpoint
// remounts it) or a reload loses none of it, until the decision is answered, by it or from elsewhere.
import { z } from "zod";
import { MAX_ANSWER_CHARS, type DecisionId } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** Where the browser keeps the answer typed to one decision. */
export const answerDraftKeyOf = (coordinatorId: CoordinatorId, decisionId: DecisionId): string => `coordinator-decision-answer:${coordinatorId}:${decisionId}`;

/** An answer typed and not sent. why never empty: an emptied field keeps nothing stored. */
export const answerDraftSchema = z.string().min(1).max(MAX_ANSWER_CHARS);

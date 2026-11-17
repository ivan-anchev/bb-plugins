// A decision the coordinating thread put to the user with crew_ask_user: its question, the options
// it offered (none: the user answers in their own words), when it asked, and the user's answer once
// given. The question and options are the thread's own words, so its doorbell may quote the
// question; the answer is the user's, and reaches the thread only through crew_catch_up.
import { z } from "zod";
import type { BoardState } from "./board/crew-state.ts";
import { issueIdSchema } from "./issue/issue.ts";
import { ONE_LINE } from "./one-line.ts";

/** A decision's id: `d1`, `d2`… across every coordinating thread, never reused. */
export const decisionIdSchema = z.string().regex(/^d[1-9][0-9]*$/, "A decision id is d1, d2 and so on").brand<"decisionId">();
export type DecisionId = z.infer<typeof decisionIdSchema>;

export const questionSchema = z.string().trim().min(1).max(500).regex(ONE_LINE, "A question is one line");

/** Each option is a button on the board, so one short line; two alike would be one choice. */
export const optionsSchema = z
  .array(z.string().trim().min(1).max(80).regex(ONE_LINE, "An option is one line"))
  .max(5)
  .refine((options) => new Set(options).size === options.length, "Each option must differ from the others");

/** The longest answer the board takes in the user's own words. */
export const MAX_ANSWER_CHARS = 5_000;
export const answerSchema = z.string().trim().min(1).max(MAX_ANSWER_CHARS);

/** A decision as the board and crew_catch_up read it: the user's answer and when they gave it, null until they do. */
export const decisionSchema = z.object({
  id: decisionIdSchema,
  question: z.string(),
  options: z.array(z.string()),
  askedAt: z.number(),
  answer: z.object({ text: z.string(), at: z.number() }).nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

/** A decision, with the issue it flags Needs you until the user answers (null: none). Replaces decisionSchema in commit 2. */
export const nextDecisionSchema = decisionSchema.extend({ issueId: issueIdSchema.nullable() });
export type NextDecision = z.infer<typeof nextDecisionSchema>;

/** Where a decision sits on the board: under Needs you until the user answers it, then Done. */
export const decisionState = (decision: Decision): BoardState => (decision.answer === null ? "needs-you" : "done");

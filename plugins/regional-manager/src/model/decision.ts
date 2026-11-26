// A decision the coordinating thread put to the user with crew_ask_user: its question, the options
// it offered (none: the user answers in their own words), when it asked, and the user's answer once
// given. The question and options are the thread's own words, or at an issue's cap the plugin's
// (rounds/cap.ts), so its doorbell may quote the question; the answer is the user's, and reaches the thread only through crew_catch_up. A question
// naming an issue stays among that issue's decisions, with those the thread recorded on it.
import { z } from "zod";
import { issueIdSchema, type IssueId } from "./issue/issue.ts";
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

/**
 * A decision as the board and crew_catch_up read it: the issue it flags Needs you until the user
 * answers (null: none), and the user's answer and when they gave it, null until they do. `cap`: for
 * a question the plugin itself asked at the issue's cap of failed verdicts (rounds/cap.ts), the
 * count it asked at; null for one the regional manager asked with crew_ask_user. `recommended`: the
 * option the regional manager recommended, null for none, and always for the plugin's own question.
 * `issueId` is null only for a question asked before crew_ask_user required an issue.
 */
export const decisionSchema = z.object({
  id: decisionIdSchema,
  issueId: issueIdSchema.nullable(),
  question: z.string(),
  options: z.array(z.string()),
  recommended: z.string().nullable(),
  askedAt: z.number(),
  answer: z.object({ text: z.string(), at: z.number() }).nullable(),
  cap: z.number().int().min(1).nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

/** A question as it is put to the user, before it has an id: every new one names the issue it is about. */
export type NewDecision = Pick<Decision, "question" | "options" | "recommended" | "cap"> & { issueId: IssueId };

/** A decision the user hasn't answered yet: it sits under Needs you until they do. */
export type OpenDecision = Decision & { answer: null };
export const isOpen = (decision: Decision): decision is OpenDecision => decision.answer === null;

/** A decision the regional manager records on an issue with issue_update: what was decided and why, in a line or a few. */
export const decisionTextSchema = z.string().trim().min(1).max(2_000);

/**
 * One of an issue's decisions: a question put to the user about it, with crew_ask_user or by the
 * plugin at its cap (`cap`, as Decision has it), the options it offered and the one it recommended, and their answer once given
 * (null: not yet), or a decision the regional manager recorded on it. `at`: when it was asked, or recorded.
 */
export const issueDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asked"), id: decisionIdSchema, question: z.string(), options: z.array(z.string()), recommended: decisionSchema.shape.recommended, at: z.number(), answer: decisionSchema.shape.answer, cap: decisionSchema.shape.cap }),
  z.object({ kind: z.literal("recorded"), text: z.string(), at: z.number() }),
]);
export type IssueDecision = z.infer<typeof issueDecisionSchema>;
export type AskedDecision = Extract<IssueDecision, { kind: "asked" }>;
export type RecordedDecision = Extract<IssueDecision, { kind: "recorded" }>;

/** The issue's decisions, its one list, oldest first: every question put to the user naming it, answered or not, and every decision recorded on it. */
export function issueDecisions(issueId: IssueId, asked: readonly Decision[], recorded: readonly RecordedDecision[]): IssueDecision[] {
  const questions = asked.filter((decision) => decision.issueId === issueId).map(({ id, question, options, recommended, askedAt, answer, cap }) => ({ kind: "asked", id, question, options, recommended, at: askedAt, answer, cap }) as const);
  return [...questions, ...recorded].sort((a, b) => a.at - b.at);
}

/** The issue's decisions as issue_read and an agent's first message show them: how to read them, then one list item each, oldest first. */
export function decisionsText(decisions: readonly IssueDecision[]): string {
  const items = decisions.map((decision) => `- ${timeOf(decision.at)}: ${indented(entryText(decision))}`);
  return ["Oldest first; where two disagree, the later one wins.", items.join("\n")].join("\n\n");
}

function entryText(decision: IssueDecision): string {
  switch (decision.kind) {
    case "asked": {
      const { id, question, recommended, answer } = decision;
      const advised = recommended === null ? "" : ` The recommended option was "${recommended}".`;
      return `asked the user (${id}): ${question}${advised} ${answer === null ? "Not answered yet." : `They answered at ${timeOf(answer.at)}: ${answer.text}`}`;
    }
    case "recorded":
      return decision.text;
    default:
      return decision satisfies never;
  }
}

const timeOf = (at: number): string => new Date(at).toISOString();

/** Text whose later lines sit under its list item. */
const indented = (text: string): string => text.replace(/\n/g, "\n  ");

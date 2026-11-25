// The cap on an issue's failed verdicts: how many of its agents' done handoffs may fail verification
// before the plugin stops sending failures back and asks the user. Nothing here is stored but the
// count each question was asked at (decisions.cap), and on the failure's `checked` event, the
// question it asked: the failures are counted from the issue's checks every time, those settled
// before the cap existed included, and the lock is an unanswered cap question naming an open issue.
import type { Decision, DecisionId } from "../../decision.ts";
import type { IssueId } from "../../issue/issue.ts";
import type { Check } from "../check.ts";
import { failureHeadline, outcome, type Verdict } from "../verdict.ts";

/** How many failed verdicts an issue gets, across all its agents, before the user is asked. */
export const MAX_FAILED_VERDICTS = 3;

/** A question the plugin put to the user at an issue's cap, with `cap`, the count of failed verdicts it asked at. */
export type CapQuestion = Decision & { cap: number };

const isCapQuestion = (decision: Decision): decision is CapQuestion => decision.cap !== null;

/** The cap questions naming the issue, in the order asked. */
export const capQuestionsOf = (decisions: readonly Decision[], issueId: IssueId): CapQuestion[] =>
  decisions.filter((decision): decision is CapQuestion => isCapQuestion(decision) && decision.issueId === issueId);

/**
 * The issue's failed verdicts that count toward its cap, from its record (every handoff with its
 * check, oldest first), in that order: every check of a done handoff whose verdict settled as a
 * failure. why not one that couldn't run or was superseded: it judged nothing and found nothing
 * failing. why not a final check's: it judges merged work on the default branch, no agent's round.
 */
export const countedFailures = (record: readonly { check: Check | null }[]): Check[] =>
  record.flatMap(({ check }) => (check !== null && check.subject.kind === "handoff" && outcome(check.verdict) === "fail" ? [check] : []));

/**
 * The one rule for the cap, deciding both whether a failure goes back to nobody and whether the
 * plugin asks: with `failed` failures counted, the count to ask the user at, or null. It asks once
 * the cap is reached, while no cap question of the issue is open, and only above every count it
 * asked at before, so each answer allows one more round.
 */
export function capAsks(failed: number, questions: readonly Pick<CapQuestion, "cap" | "answer">[]): number | null {
  if (failed < MAX_FAILED_VERDICTS || questions.some(({ answer }) => answer === null)) return null;
  return questions.every(({ cap }) => cap < failed) ? failed : null;
}

/** The issue's cap question the user hasn't answered yet; null: none. */
export const unansweredCapQuestion = (questions: readonly CapQuestion[]): CapQuestion | null => questions.find(({ answer }) => answer === null) ?? null;

/**
 * The lock: the issue's unanswered cap question while the issue is open (`closed`: whether it is
 * closed, Done or Canceled, as by a merge or a cancel); null when nothing locks it. why not on a
 * closed issue: nothing is left for its answer to allow, and the question leaves Needs you.
 */
export const capLock = (questions: readonly CapQuestion[], closed: boolean): CapQuestion | null => (closed ? null : unansweredCapQuestion(questions));

/**
 * Whether a decision still waits for the user: unanswered, and not a cap question whose issue closed
 * meanwhile (`closed`: whether the issue it names is closed). The one rule the board, the rail badge
 * and crew_catch_up read decisions by.
 */
export const stillWaits = (decision: Decision, closed: (issueId: IssueId) => boolean): boolean =>
  decision.answer === null && !(isCapQuestion(decision) && decision.issueId !== null && closed(decision.issueId));

/** Whether a failure about to settle as the issue's `failed`th may go back to its agent: never while a cap question is unanswered, nor when it asks one. */
export const mayGoBack = (failed: number, questions: readonly CapQuestion[]): boolean => unansweredCapQuestion(questions) === null && capAsks(failed, questions) === null;

/** The cap question a `checked` event names as asked. why throw: the event is recorded with its question, in one transaction, and only the plugin asks one. */
export function askedQuestion(decision: Decision | null): CapQuestion {
  if (decision === null || !isCapQuestion(decision)) throw new Error("A failure's cap question is missing.");
  return decision;
}

/** Where an issue stands against its cap when it was asked at `cap` failures, leading its Needs you reason: "At its cap of 3 failed verifications". */
export const capText = (cap: number): string =>
  cap === MAX_FAILED_VERDICTS ? `At its cap of ${MAX_FAILED_VERDICTS} failed verifications` : `At ${cap} failed verifications, past its cap of ${MAX_FAILED_VERDICTS}`;

/** How a count of failed verifications stands against the cap, as catch-up and the question word it: "its cap", "past its cap of 3". */
const pastCap = (cap: number): string => (cap === MAX_FAILED_VERDICTS ? "its cap" : `past its cap of ${MAX_FAILED_VERDICTS}`);

/** What the regional manager can do while the cap question `questionId` locks `issueId`: only the moves that work then. */
export const capMovesText = (issueId: IssueId, questionId: DecisionId): string =>
  `Wait for their answer, which crew_catch_up brings you; or reply on ${issueId} with issue_comment, pointing them at ${questionId} on the board; or stop its agent with agent_stop and cancel ${issueId} with issue_update.`;

/** What a failure that asked did, in a sentence: "BBP-2's 3rd failed verification, its cap: nothing went back to an agent, and the plugin asked the user (d4)". */
export const askedText = (issueId: IssueId, { cap, id }: CapQuestion): string =>
  `${issueId}'s ${ordinal(cap)} failed verification, ${pastCap(cap)}: nothing went back to an agent, and the plugin asked the user (${id})`;

/** The options a cap question offers; any answer allows one more round, and the regional manager reads the words. */
export const CAP_OPTIONS = ["One more round", "Cancel it"];

/**
 * The question the plugin asks at an issue's cap, leading with why its last round failed (`last`,
 * as the failure's headline words it) and how many criteria passed, then the count it asks at.
 * why no agent's words: a doorbell may quote the question (wake-text.ts), so it holds only what
 * the plugin derived; the round in the issue's tab has the rest. Bounded well under the question's
 * 500 characters, as every part is a word or a number.
 */
export function capQuestionText(issueId: IssueId, last: Extract<Verdict, { state: "returned" }>, cap: number): string {
  const passed = last.criteria.filter(({ result }) => result === "pass").length;
  return `${failureHeadline(last)}, ${passed} of ${last.criteria.length} criteria passed. ${issueId} has failed verification ${cap} times, ${pastCap(cap)}: nothing goes back to an agent until you answer, and any answer allows one more round.`;
}

/** An ordinal in words a round's score and a catch-up use: 3rd, 4th, 21st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

// What a verdict found, written for an agent: a checkout that wasn't the claimed commit on a clean
// tree, as bb's git plugin read it, each done-criterion it didn't pass, with the verifier's
// evidence, CI's failure on its pull request, its blocking defects and other findings, and the
// reviewer's findings that fail it, with only a count of the others that held, or that no review
// was had. It reaches the agent as the verifier's message when a failed verdict goes back for its
// fix round. And what an earlier agent's
// verdict found, whole and in the past tense, for the agent that takes its issue over.
import { attachmentsText } from "../../model/attachment.ts";
import { checkoutText } from "../../model/verdict/checkout.ts";
import { checkNamesText, FORGE, prRef, type CiVerdict } from "../../model/verdict/pr.ts";
import type { Check } from "../../model/verdict/check.ts";
import { defectText, findingText, FOLLOW_UP_RULE, triageText, type Review } from "../../model/verdict/review.ts";
import { ciVerdictOf, heldFindings, failedCheckout, failureReasons, failureText, verifierFindingText, type CriterionResult, type FailureReason, type Verdict } from "../../model/verdict/verdict.ts";

type Returned = Extract<Verdict, { state: "returned" }>;

/** The message an agent gets from its verifier when its done handoff failed and goes back to it, with what CI said about its commit and what of its review fails it. */
export function findingsMessage(review: Review, verdict: Returned, ci: CiVerdict): string {
  return [
    `## Verifier findings: ${notPassed(failureReasons(verdict, ci))}`,
    `A verifier checked your done handoff at commit \`${short(verdict.headSha)}\` and it doesn't pass yet. Fix what it found, commit, and call agent_handoff with done again: a new verifier checks the new commit. This is your one automatic fix round. If the next check fails too, your regional manager decides what happens next.`,
    ...whatFailed(verdict, ci),
    ...heldPart(review, verdict),
  ].join("\n\n");
}

/**
 * The findings that fail the verdict on their own, each with what it breaks in the verifier's
 * word and its reason, for the agent to fix; then how many more held, never what they say, as they
 * don't go back (review.ts FOLLOW_UP_RULE). After a missed review, that none was had first, and
 * the earlier blocking findings that failed it again as unfixed among them. Nothing when none held
 * and a review was had, or the check had no review stage.
 */
function heldPart(review: Review, verdict: Returned): string[] {
  const missed = review.state === "missed" ? [`### Review\n\nNo review was had: ${review.reason}.`] : [];
  const { failing, others } = heldFindings(verdict);
  const list = failing.map((finding) => `- ${findingText(finding, "  ")}\n  The verifier: ${triageText(finding)}. ${finding.reason}`).join("\n");
  return [
    ...missed,
    ...(failing.length === 0 ? [] : [`### Must-fix review findings the verifier upheld\n\nEach of these fails the verdict on its own, whatever the done-criteria say.\n\n${list}`]),
    ...(others.length === 0 ? [] : [othersText(others.length)]),
  ];
}

/** How many more of the reviewer's findings held without failing the verdict, which the round doesn't carry. */
function othersText(count: number): string {
  const more = count === 1 ? "1 more review finding" : `${count} more review findings`;
  return `### Other review findings\n\n${more} held without failing the verdict, so this round doesn't carry ${count === 1 ? "it" : "them"}. ${FOLLOW_UP_RULE}`;
}

/**
 * What the check of an earlier agent's done handoff found, for the agent that takes its issue over,
 * in past-tense words that describe and ask nothing: every criterion with its result and the
 * verifier's evidence, the checkout and CI as they were, and every finding, whatever the result;
 * or why nobody checked it. The verifier's own words are quoted, so none of their Markdown reads as
 * the message's.
 */
export function earlierVerdictText({ review, verdict }: Check): string {
  switch (verdict.state) {
    case "queued":
    case "running":
    case "superseded":
      return "Not checked: a newer handoff or the handover came before its verdict.";
    case "could-not-run":
      return `Not checked: ${verdict.reason}.`;
    case "waived":
      return "Not checked: verification was off.";
    case "returned":
      return returnedText(review, verdict);
    default:
      return verdict satisfies never;
  }
}

/** A returned verdict as it stood: its result, the checkout and CI when they failed it or CI never came, each criterion, the findings, its review as the verifier triaged it, then the files it attached. */
function returnedText(review: Review, verdict: Returned): string {
  const ci = ciVerdictOf(verdict);
  const reasons = failureReasons(verdict);
  const at = `at \`${short(verdict.headSha)}\``;
  const failed = failedCheckout(verdict);
  const result = [
    reasons.length === 0 ? `Passed ${at}: every done-criterion was met.` : `Failed ${at}: ${notPassed(reasons)}.`,
    ...(failed === null ? [] : [checkoutText(verdict.headSha, failed)]),
    ...(ci?.kind === "fail" ? [`CI failed on ${prRef(ci)}. ${ciFailure(ci)}`] : []),
    ...(verdict.settlement.kind === "superseded" ? ["CI was still to finish on this commit when a newer handoff or the handover replaced it, so it was never judged."] : []),
  ].join(" ");
  const criteria = verdict.criteria.map(({ criterion, result, shows, evidence }, i) => `${i + 1}. ${criterion}: ${PAST[result]}. What the run showed, then the verifier's evidence:\n\n${fenced(`${shows}\n\n${evidence}`)}`);
  const blocking = verdict.blocking.length === 0 ? [] : [`The defects it found itself that blocked, in its words:\n\n${fenced(verdict.blocking.map((defect) => `- ${defectText(defect, "  ")}`).join("\n"))}`];
  const findings = verdict.findings.length === 0 ? "It found nothing else." : `Its other findings, in its words:\n\n${fenced(verdict.findings.map((finding) => `- ${verifierFindingText(finding, "  ")}`).join("\n"))}`;
  const attachments = attachmentsText(verdict.attachments, "The verifier's attachments");
  return [result, ...criteria, ...blocking, findings, ...reviewedPart(review, verdict), ...(attachments === "" ? [] : [fenced(attachments)])].join("\n\n");
}

/**
 * Its review, as it stood: each finding its verifier triaged, with the triage, quoted; or that no
 * review was had, then the earlier blocking findings it triaged as unfixed. Nothing for a check
 * with no review stage.
 */
function reviewedPart(review: Review, verdict: Returned): string[] {
  const each = fenced(verdict.triage.map((finding) => `- ${findingText(finding, "  ")}\n  ${triageText(finding)}: ${finding.reason}`).join("\n"));
  if (review.state === "missed") return [`No review was had: ${review.reason}.`, ...(verdict.triage.length === 0 ? [] : [`The earlier blocking findings, as the verifier triaged them, in their words:\n\n${each}`])];
  if (review.state !== "reported") return [];
  if (review.findings.length === 0) return ["Its reviewer found nothing."];
  return [`Its reviewer's findings, as the verifier triaged them, in their words:\n\n${each}`];
}

const PAST: Record<CriterionResult, string> = { pass: "passed", fail: "failed", unverifiable: "couldn't be checked" };

/** Why the verdict didn't pass (`reasons`, verdict.ts failureReasons), in words, its reasons first; then, when every criterion passed, that they did. */
function notPassed(reasons: readonly FailureReason[]): string {
  const words = reasons.map((reason) => (reason.kind === "criteria" ? `${reason.failed} of ${reason.of} done-criteria not met` : failureText(reason, "handoff")));
  const listed = words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
  return reasons.some(({ kind }) => kind === "criteria") ? listed : `${listed}, though every done-criterion passed`;
}

/** The checkout, when it wasn't the claimed commit on a clean tree; then each criterion that didn't pass, numbered as in the brief, with its evidence; then CI's failure; then the verifier's blocking defects, then its other findings. */
function whatFailed(verdict: Returned, ci: CiVerdict | null): string[] {
  const failed = failedCheckout(verdict);
  const checkout =
    failed === null
      ? []
      : [`### The commit and the tree\n\n${checkoutText(verdict.headSha, failed)} Commit what belongs to the work and remove what doesn't, so the commit you hand off is checked out on a clean tree.`];
  const checks = verdict.criteria.flatMap((check, i) => (check.result === "pass" ? [] : [`### ${i + 1}. ${check.criterion}\n\n**${RESULT[check.result]}.** What the run showed, then the verifier's evidence:\n\n${fenced(`${check.shows}\n\n${check.evidence}`)}`]));
  const failedCi = ci?.kind === "fail" ? [`### CI failed on ${prRef(ci)}\n\n${ciFailure(ci)} Read the runs on the ${FORGE[ci.forge].noun}, fix the cause, and push.`] : [];
  const blocking =
    verdict.blocking.length === 0
      ? []
      : [`### Blocking defects the verifier found\n\nEach of these fails the verdict on its own, whatever the done-criteria say.\n\n${verdict.blocking.map((defect) => `- ${defectText(defect, "  ")}`).join("\n")}`];
  const findings = verdict.findings.length === 0 ? [] : [`### Other findings\n\n${verdict.findings.map((finding) => `- ${verifierFindingText(finding, "  ")}`).join("\n")}`];
  return [...checkout, ...checks, ...failedCi, ...blocking, ...findings];
}

/** The failed checks, by the names the forge gives them. */
const ciFailure = ({ forge, failedChecks }: Extract<CiVerdict, { kind: "fail" }>): string =>
  failedChecks.length === 0 ? `${FORGE[forge].name} reports CI as failed on this commit, and names no failed check.` : `Failed checks on this commit: ${checkNamesText(failedChecks)}.`;

const RESULT: Record<Exclude<CriterionResult, "pass">, string> = { fail: "Failed", unverifiable: "Couldn't be checked" };

/** The text in a code block whose fence no run of backticks inside it can close: quoted whole, so none of its Markdown reads as the text around it. */
export function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

const short = (sha: string): string => sha.slice(0, 7);

// What a verdict found, written for an agent: a checkout that wasn't the claimed commit on a clean
// tree, as bb's git plugin read it, each done-criterion it didn't pass, with the verifier's
// evidence, CI's failure on its pull request, its findings, and the reviewer's findings that
// held, the ones that fail it first, never one it rejected, or that no review was had. It reaches the agent as the verifier's message when a failed verdict goes back for its fix
// round. And what an earlier agent's
// verdict found, whole and in the past tense, for the agent that takes its issue over.
import { checkoutText } from "../../model/verdict/checkout.ts";
import type { CiVerdict } from "../../model/verdict/pr.ts";
import type { Check } from "../../model/verdict/check.ts";
import { findingText, triageText, type Review } from "../../model/verdict/review.ts";
import { ciVerdictOf, heldFindings, failedCheckout, failureReasons, failureText, type CriterionResult, type FailureReason, type Verdict } from "../../model/verdict/verdict.ts";

type Returned = Extract<Verdict, { state: "returned" }>;

/** The message an agent gets from its verifier when its done handoff failed and goes back to it, with what CI said about its commit and what of its review held. */
export function findingsMessage(review: Review, verdict: Returned, ci: CiVerdict): string {
  return [
    `## Verifier findings: ${notPassed(failureReasons(verdict, ci))}`,
    `A verifier checked your done handoff at commit \`${short(verdict.headSha)}\` and it doesn't pass yet. Fix what it found, commit, and call agent_handoff with done again: a new verifier checks the new commit. This is your one automatic fix round. If the next check fails too, your regional manager decides what happens next.`,
    ...whatFailed(verdict, ci),
    ...heldPart(review, verdict),
  ].join("\n\n");
}

/**
 * The findings that held, each with the verifier's word on it and its reason, for the agent to
 * fix: those that failed the verdict on their own, then the others; after a missed review, that
 * none was had first, and then the earlier blocking findings that held as unfixed. Nothing when
 * none held and a review was had, or the check had no review stage.
 */
function heldPart(review: Review, verdict: Returned): string[] {
  const missed = review.state === "missed" ? [`### Review\n\nNo review was had: ${review.reason}.`] : [];
  const { failing, others } = heldFindings(verdict);
  const list = (findings: Returned["triage"]) => findings.map((finding) => `- ${findingText(finding, "  ")}\n  The verifier: ${triageText(finding)}. ${finding.reason}`).join("\n");
  return [
    ...missed,
    ...(failing.length === 0 ? [] : [`### Must-fix review findings the verifier upheld\n\nEach of these fails the verdict on its own, whatever the done-criteria say.\n\n${list(failing)}`]),
    ...(others.length === 0 ? [] : [`### ${failing.length === 0 ? "Review findings" : "Other review findings"} that held\n\n${list(others)}`]),
  ];
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

/** A returned verdict as it stood: its result, the checkout and CI when they failed it or CI never came, each criterion, the findings, then its review as the verifier triaged it. */
function returnedText(review: Review, verdict: Returned): string {
  const ci = ciVerdictOf(verdict);
  const reasons = failureReasons(verdict);
  const at = `at \`${short(verdict.headSha)}\``;
  const failed = failedCheckout(verdict);
  const result = [
    reasons.length === 0 ? `Passed ${at}: every done-criterion was met.` : `Failed ${at}: ${notPassed(reasons)}.`,
    ...(failed === null ? [] : [checkoutText(verdict.headSha, failed)]),
    ...(ci?.kind === "fail" ? [`CI failed on #${ci.number}. ${ciFailure(ci.failedChecks)}`] : []),
    ...(verdict.settlement.kind === "superseded" ? ["CI was still to finish on this commit when a newer handoff or the handover replaced it, so it was never judged."] : []),
  ].join(" ");
  const criteria = verdict.criteria.map(({ criterion, result, evidence }, i) => `${i + 1}. ${criterion}: ${PAST[result]}. The verifier's evidence:\n\n${fenced(evidence)}`);
  const findings = verdict.findings.length === 0 ? "It found nothing else." : `Its other findings, in its words:\n\n${fenced(verdict.findings.map((finding) => `- ${finding}`).join("\n"))}`;
  return [result, ...criteria, findings, ...reviewedPart(review, verdict)].join("\n\n");
}

/**
 * Its review, as it stood: each finding its verifier triaged, with the triage, quoted; or that no
 * review was had, then the earlier blocking findings it triaged as unfixed. Nothing for a check
 * with no review stage.
 */
function reviewedPart(review: Review, verdict: Returned): string[] {
  const each = fenced(verdict.triage.map((finding) => `- ${findingText(finding)}\n  ${triageText(finding)}: ${finding.reason}`).join("\n"));
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

/** The checkout, when it wasn't the claimed commit on a clean tree; then each criterion that didn't pass, numbered as in the brief, with its evidence; then CI's failure; then the findings. */
function whatFailed(verdict: Returned, ci: CiVerdict | null): string[] {
  const failed = failedCheckout(verdict);
  const checkout =
    failed === null
      ? []
      : [`### The commit and the tree\n\n${checkoutText(verdict.headSha, failed)} Commit what belongs to the work and remove what doesn't, so the commit you hand off is checked out on a clean tree.`];
  const checks = verdict.criteria.flatMap((check, i) => (check.result === "pass" ? [] : [`### ${i + 1}. ${check.criterion}\n\n**${RESULT[check.result]}.** The verifier's evidence:\n\n${fenced(check.evidence)}`]));
  const failedCi = ci?.kind === "fail" ? [`### CI failed on #${ci.number}\n\n${ciFailure(ci.failedChecks)} Read the runs on the pull request, fix the cause, and push.`] : [];
  const findings = verdict.findings.length === 0 ? [] : [`### Other findings\n\n${verdict.findings.map((finding) => `- ${finding.replaceAll("\n", "\n  ")}`).join("\n")}`];
  return [...checkout, ...checks, ...failedCi, ...findings];
}

/** The failed checks, by the names GitHub gives them. */
const ciFailure = (failedChecks: readonly string[]): string =>
  failedChecks.length === 0 ? "GitHub reports CI as failed on this commit, and names no failed check." : `Failed checks on this commit: ${failedChecks.map((name) => `\`${name}\``).join(", ")}.`;

const RESULT: Record<Exclude<CriterionResult, "pass">, string> = { fail: "Failed", unverifiable: "Couldn't be checked" };

/** The text in a code block whose fence no run of backticks inside it can close: quoted whole, so none of its Markdown reads as the text around it. */
export function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

const short = (sha: string): string => sha.slice(0, 7);

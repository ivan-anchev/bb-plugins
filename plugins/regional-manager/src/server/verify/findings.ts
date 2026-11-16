// What a verdict found, written for a crew: a checkout that wasn't the claimed commit on a clean
// tree, as bb's git plugin read it, each done-criterion it didn't pass, with the verifier's
// evidence, CI's failure on its pull request, and its findings. It reaches a crew twice: as the
// verifier's message when a failed verdict goes back for its fix round, and in the brief of a
// fresh crew that supersedes one.
import type { Crew } from "../../model/crew.ts";
import { checkoutText } from "../../model/verdict/checkout.ts";
import type { CiVerdict } from "../../model/verdict/pr.ts";
import { ciVerdictOf, failedCheckout, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";

type Returned = Extract<Verdict, { state: "returned" }>;

/** The message a crew gets from its verifier when its done handoff failed and goes back to it, with what CI said about its commit. */
export function findingsMessage(verdict: Returned, ci: CiVerdict): string {
  return [
    `## Verifier findings: ${notPassed(verdict, ci)}`,
    `A verifier checked your done handoff at commit \`${short(verdict.headSha)}\` and it doesn't pass yet. Fix what it found, commit, and call crew_handoff with done again: a new verifier checks the new commit. This is your one automatic fix round. If the next check fails too, your regional manager decides what happens next.`,
    whatFailed(verdict, ci),
  ].join("\n\n");
}

/**
 * The brief of a crew that supersedes `old`: the brief it is given, then `old`'s latest verdict
 * (null: no verifier returned one on its work).
 */
export function supersedingBrief(old: Pick<Crew, "id">, brief: string, verdict: Returned | null): string {
  const heading = "## Previous attempt's verifier findings";
  if (verdict === null) return [brief.trim(), heading, `Crew ${old.id} worked on this before you and was stopped. No verifier returned a verdict on its work.`].join("\n\n");
  const ci = ciVerdictOf(verdict);
  return [
    brief.trim(),
    heading,
    `Crew ${old.id} worked on this before you, on its own branch, and was stopped. Its latest verdict, on its commit \`${short(verdict.headSha)}\`: ${notPassed(verdict, ci)}. Start from what it found.`,
    whatFailed(verdict, ci),
  ].join("\n\n");
}

/** How many done-criteria the verdict didn't pass, and whether the checkout or CI failed, in words. `ci`: null while the verdict was not settled. */
function notPassed(verdict: Returned, ci: CiVerdict | null): string {
  const count = verdict.criteria.filter((check) => check.result !== "pass").length;
  const parts = [
    count === 0 ? "every done-criterion passed" : `${count} of ${verdict.criteria.length} done-criteria not met`,
    ...(failedCheckout(verdict) === null ? [] : ["the claimed commit wasn't checked out on a clean tree"]),
    ...(ci?.kind === "fail" ? [`CI failed on #${ci.number}`] : []),
  ];
  return parts.length === 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** The checkout, when it wasn't the claimed commit on a clean tree; then each criterion that didn't pass, numbered as in the brief, with its evidence; then CI's failure; then the findings. */
function whatFailed(verdict: Returned, ci: CiVerdict | null): string {
  const failed = failedCheckout(verdict);
  const checkout =
    failed === null
      ? []
      : [`### The commit and the tree\n\n${checkoutText(verdict.headSha, failed)} Commit what belongs to the work and remove what doesn't, so the commit you hand off is checked out on a clean tree.`];
  const checks = verdict.criteria.flatMap((check, i) => (check.result === "pass" ? [] : [`### ${i + 1}. ${check.criterion}\n\n**${RESULT[check.result]}.** The verifier's evidence:\n\n${fenced(check.evidence)}`]));
  const failedCi = ci?.kind === "fail" ? [`### CI failed on #${ci.number}\n\n${ciFailure(ci.failedChecks)} Read the runs on the pull request, fix the cause, and push.`] : [];
  const findings = verdict.findings.length === 0 ? [] : [`### Other findings\n\n${verdict.findings.map((finding) => `- ${finding.replaceAll("\n", "\n  ")}`).join("\n")}`];
  return [...checkout, ...checks, ...failedCi, ...findings].join("\n\n") || "It found nothing to fix.";
}

/** The failed checks, by the names GitHub gives them. */
const ciFailure = (failedChecks: readonly string[]): string =>
  failedChecks.length === 0 ? "GitHub reports CI as failed on this commit, and names no failed check." : `Failed checks on this commit: ${failedChecks.map((name) => `\`${name}\``).join(", ")}.`;

const RESULT: Record<Exclude<CriterionResult, "pass">, string> = { fail: "Failed", unverifiable: "Couldn't be checked" };

/** The text in a code block whose fence no run of backticks inside it can close. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

const short = (sha: string): string => sha.slice(0, 7);

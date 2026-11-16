// What a verdict found, written for a crew: each done-criterion it didn't pass, with the verifier's
// evidence, and its findings. It reaches a crew twice: as the verifier's message when a failed
// verdict goes back for its fix round, and in the brief of a fresh crew that supersedes one.
import type { Crew } from "../../model/crew.ts";
import type { CriterionResult, Verdict } from "../../model/verdict.ts";

type Returned = Extract<Verdict, { state: "returned" }>;

/** The message a crew gets from its verifier when its done handoff failed and goes back to it. */
export function findingsMessage(verdict: Returned): string {
  return [
    `## Verifier findings: ${notPassed(verdict)}`,
    `A verifier checked your done handoff at commit \`${short(verdict.headSha)}\` and it doesn't pass yet. Fix what it found, commit, and call crew_handoff with done again: a new verifier checks the new commit. This is your one automatic fix round. If the next check fails too, your coordinator decides what happens next.`,
    whatFailed(verdict),
  ].join("\n\n");
}

/**
 * The brief of a crew that supersedes `old`: the brief it is given, then `old`'s latest verdict
 * (null: no verifier returned one on its work).
 */
export function supersedingBrief(old: Pick<Crew, "id">, brief: string, verdict: Returned | null): string {
  const heading = "## Previous attempt's verifier findings";
  if (verdict === null) return [brief.trim(), heading, `Crew ${old.id} worked on this before you and was stopped. No verifier returned a verdict on its work.`].join("\n\n");
  return [
    brief.trim(),
    heading,
    `Crew ${old.id} worked on this before you, on its own branch, and was stopped. Its latest verdict, on its commit \`${short(verdict.headSha)}\`: ${notPassed(verdict)}. Start from what it found.`,
    whatFailed(verdict),
  ].join("\n\n");
}

/** How many done-criteria the verdict didn't pass, in words. */
function notPassed(verdict: Returned): string {
  const count = verdict.criteria.filter((check) => check.result !== "pass").length;
  if (count === 0) return "every done-criterion passed";
  return `${count} of ${verdict.criteria.length} done-criteria not met`;
}

/** Each criterion that didn't pass, numbered as in the brief, with its evidence; then the findings. */
function whatFailed(verdict: Returned): string {
  const checks = verdict.criteria.flatMap((check, i) => (check.result === "pass" ? [] : [`### ${i + 1}. ${check.criterion}\n\n**${RESULT[check.result]}.** The verifier's evidence:\n\n${fenced(check.evidence)}`]));
  const findings = verdict.findings.length === 0 ? [] : [`### Other findings\n\n${verdict.findings.map((finding) => `- ${finding.replaceAll("\n", "\n  ")}`).join("\n")}`];
  return [...checks, ...findings].join("\n\n") || "It found nothing to fix.";
}

const RESULT: Record<Exclude<CriterionResult, "pass">, string> = { fail: "Failed", unverifiable: "Couldn't be checked" };

/** The text in a code block whose fence no run of backticks inside it can close. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

const short = (sha: string): string => sha.slice(0, 7);

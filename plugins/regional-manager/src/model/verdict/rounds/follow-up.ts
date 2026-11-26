// A follow-up: when an issue passes, every finding its rounds held without blocking it is filed as
// one new build issue, top-level in Backlog, that depends on its origin, so its agent never starts
// from a default branch without the origin's code. Nothing here is stored but which follow-up
// collected each check (checks.follow_up_id): what a round left over is read from its verdict, and
// a follow-up's first origin by following that column back.
import type { Issue, IssueId, NewIssue } from "../../issue/issue.ts";
import type { Check } from "../check.ts";
import { findingText, triageText, type Triaged } from "../review.ts";
import { heldFindings } from "../verdict.ts";

/** A round's leftovers, numbered as the issue's feed numbers its rounds. */
type Collected = { round: number; leftovers: readonly Triaged[] };

/** What a check held without failing its verdict: every finding the verifier didn't reject that doesn't fail it on its own, downgraded ones included. [] while its verdict hasn't returned. */
export const leftoversOf = ({ verdict }: Pick<Check, "verdict">): Triaged[] => (verdict.state === "returned" ? heldFindings(verdict).others : []);

/**
 * The follow-up to file for `origin`'s collected rounds, titled after `firstOrigin`, the issue its
 * chain of follow-ups began at (`origin` itself when it is no follow-up); null when no leftover is
 * a confirmed should-fix or a downgraded must-fix, as nits alone stay in the origin's feed. Its
 * brief lists each finding once, by file, line and claim as written, from the latest round that
 * held it. why no done-criteria: the manager plans it before an agent can start (issue.ts briefToStart).
 */
export function followUpPlan(origin: IssueId, firstOrigin: Pick<Issue, "id" | "title">, collected: readonly Collected[]): NewIssue | null {
  const findings = latestOfEach(collected);
  if (!findings.some(warrantsFollowUp)) return null;
  return {
    kind: "build",
    title: oneTitle(`Follow-ups from ${firstOrigin.id}: ${firstOrigin.title}`),
    description: `${findings.length === 1 ? "A review finding" : `${findings.length} review findings`} that held without blocking ${origin}, filed when it passed. Plan its work and done-criteria before an agent starts.`,
    brief: briefOf(origin, findings),
    doneCriteria: [],
    verifier: null,
    rest: "backlog",
    parentId: null,
    dependsOn: [origin],
  };
}

/** A leftover with the round that held it. */
type Leftover = Triaged & { round: number };

/** Every leftover once, by file, line and claim as written, from the latest round that held it, in the order first held. */
function latestOfEach(collected: readonly Collected[]): Leftover[] {
  const byIdentity = new Map<string, Leftover>();
  for (const { round, leftovers } of collected) for (const finding of leftovers) byIdentity.set(JSON.stringify([finding.file, finding.line, finding.claim]), { ...finding, round });
  return [...byIdentity.values()];
}

/** Whether a leftover is worth a follow-up of its own: the reviewer's must-fix the verifier downgraded, or one that held as a should-fix. A nit never is. */
const warrantsFollowUp = (finding: Triaged): boolean => finding.severity === "must-fix" || severityAsTriaged(finding) === "should-fix";

/** How much a finding matters as the verifier triaged it: the severity it downgraded it to, else the reviewer's. */
const severityAsTriaged = (finding: Triaged): Triaged["severity"] => (finding.result === "downgraded" ? finding.to : finding.severity);

function briefOf(origin: IssueId, findings: readonly Leftover[]): string {
  const each = findings.map((finding) => `- Round ${finding.round}: ${findingText(finding).replaceAll("\n", "\n  ")}\n  The verifier: ${triageText(finding)}. ${finding.reason.replaceAll("\n", "\n  ")}`);
  return [
    `The reviews of ${origin} held these findings without blocking it, and it passed. Each held when its round was verified, but a later round, or work merged since, may have fixed it: check that each still holds on the default branch before you change anything, and leave alone, saying so in your handoff, any that no longer does.`,
    `Each finding with the round that held it last, its place, the reviewer's severity and claim, then the verifier's word on it (confirmed at the reviewer's severity, or downgraded to the severity it names) and its reason:`,
    each.join("\n"),
  ].join("\n\n");
}

/** A title cut to the 80 characters an issue's title holds (issue.ts titleSchema), on one line. */
function oneTitle(title: string): string {
  const line = title.replaceAll(/\s+/g, " ");
  return line.length <= 80 ? line : `${line.slice(0, 79).trimEnd()}…`;
}

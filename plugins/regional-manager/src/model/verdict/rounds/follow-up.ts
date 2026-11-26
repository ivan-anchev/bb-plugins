// A follow-up: when an issue passes, every finding its rounds held without blocking it is filed as
// one new build issue, top-level in Backlog, that depends on its origin, so its agent never starts
// from a default branch without the origin's code. When the regional manager accepts a failure on
// review findings alone, the accepted round's unfixed must-fixes are filed with them. Nothing here
// is stored but which follow-up collected each check (checks.follow_up_id) and when one was
// accepted (checks.accepted_at): what a round left over is read from its verdict, and a
// follow-up's first origin by following that column back.
import { z } from "zod";
import { MAX_TITLE_CHARS, type Issue, type IssueId, type NewIssue } from "../../issue/issue.ts";
import type { Check } from "../check.ts";
import { findingText, triageText, type Triaged } from "../review.ts";
import { heldFindings } from "../verdict.ts";
import { findingKey } from "./delta.ts";

/** A round's leftovers, numbered as the issue's feed numbers its rounds. */
type Collected = { round: number; leftovers: readonly Triaged[] };

/** How a follow-up came to be filed: its origin passed, or the regional manager accepted its failure on review findings alone. */
export const filedWhenSchema = z.enum(["passed", "accepted"]);
export type FiledWhen = z.infer<typeof filedWhenSchema>;

/** The issue a follow-up was filed for, and how. */
export type FollowUpOrigin = { issueId: IssueId; when: FiledWhen };

/** How the follow-up `id` was filed, from its origin's checks (`checks`): accepted when one that collected it was accepted, else passed. */
export const filedWhen = (checks: readonly Pick<Check, "followUpId" | "acceptedAt">[], id: IssueId): FiledWhen =>
  checks.some(({ followUpId, acceptedAt }) => followUpId === id && acceptedAt !== null) ? "accepted" : "passed";

/**
 * What a check left for a follow-up: every finding the verifier didn't reject that doesn't fail its
 * verdict on its own, downgraded ones included; on an accepted check, the ones that fail it first,
 * as nothing fixed them. [] while its verdict hasn't returned.
 */
export function leftoversOf({ verdict, acceptedAt }: Pick<Check, "verdict" | "acceptedAt">): Triaged[] {
  if (verdict.state !== "returned") return [];
  const { failing, others } = heldFindings(verdict);
  return acceptedAt === null ? others : [...failing, ...others];
}

/** Whether leftovers file nothing: none is a confirmed should-fix or a downgraded must-fix, so every one is a nit. The one rule a pass files by. */
export const onlyNits = (leftovers: readonly Triaged[]): boolean => !leftovers.some(warrantsFollowUp);

/**
 * The follow-up to file for `origin`'s collected rounds, titled after `firstOrigin`, the issue its
 * chain of follow-ups began at (`origin` itself when it is no follow-up); null when the rounds left
 * only nits (onlyNits), which stay in the origin's feed. why decided before each finding is listed
 * once: a later round may hold a finding an earlier one held as a should-fix at a lower severity,
 * and the earlier round still qualifies. Its brief lists each finding once, by file, line and claim
 * as written (delta.ts findingKey), from the latest round that held it. why no done-criteria: the
 * manager plans it before an agent can start (issue.ts briefToStart).
 */
export function followUpPlan(origin: IssueId, firstOrigin: Pick<Issue, "id" | "title">, collected: readonly Collected[], when: FiledWhen): NewIssue | null {
  if (onlyNits(collected.flatMap(({ leftovers }) => leftovers))) return null;
  const findings = latestOfEach(collected);
  return {
    kind: "build",
    title: oneTitle(`Follow-ups from ${firstOrigin.id}: ${firstOrigin.title}`),
    description: `${findings.length === 1 ? "A review finding" : `${findings.length} review findings`} ${LEFT[when](origin)}. Its brief lists each, with its round and the verifier's reason: check each still holds first. Plan this issue's done-criteria before an agent starts.`,
    brief: briefOf(origin, findings, when),
    doneCriteria: [],
    verifier: null,
    rest: "backlog",
    parentId: null,
    dependsOn: [origin],
  };
}

/**
 * The findings a merge leaves that no follow-up collected, of the issue's handoff checks (`checks`,
 * oldest first): every uncollected round's leftovers, and, when nothing collected the latest
 * returned verdict, the findings that fail it, which nothing fixed before the merge. why only the
 * latest's: a later round reviews the earlier blocking findings again (delta.ts), so its own carry
 * the ones still unfixed. why from its triage, settled or not: a merge read while the verdict waits
 * to be settled must count them as its settling will.
 */
export function unfiledAtMerge(checks: readonly Pick<Check, "subject" | "verdict" | "followUpId" | "acceptedAt">[]): Triaged[] {
  const uncollected = checks.filter(({ subject, followUpId }) => subject.kind === "handoff" && followUpId === null);
  const latest = checks.filter(({ subject, verdict }) => subject.kind === "handoff" && verdict.state === "returned").at(-1);
  const blocking = latest?.followUpId === null && latest.verdict.state === "returned" ? heldFindings(latest.verdict).failing : [];
  return [...uncollected.flatMap(leftoversOf), ...blocking];
}

/** A leftover with the round that held it. */
type Leftover = Triaged & { round: number };

/** Every leftover once, by file, line and claim as written, from the latest round that held it, in the order first held. */
function latestOfEach(collected: readonly Collected[]): Leftover[] {
  const byIdentity = new Map<string, Leftover>();
  for (const { round, leftovers } of collected) for (const finding of leftovers) byIdentity.set(findingKey(finding), { ...finding, round });
  return [...byIdentity.values()];
}

/** Whether a leftover is worth a follow-up of its own: the reviewer's must-fix the verifier downgraded, or one that held as a should-fix. A nit never is. */
const warrantsFollowUp = (finding: Triaged): boolean => finding.severity === "must-fix" || severityAsTriaged(finding) === "should-fix";

/** How much a finding matters as the verifier triaged it: the severity it downgraded it to, else the reviewer's. */
const severityAsTriaged = (finding: Triaged): Triaged["severity"] => (finding.result === "downgraded" ? finding.to : finding.severity);

/** What a follow-up's findings were left by, as its description words it. */
const LEFT: Record<FiledWhen, (origin: IssueId) => string> = {
  passed: (origin) => `held without blocking ${origin} when it passed`,
  accepted: (origin) => `left unfixed when ${origin} was accepted as it is`,
};

/** How a follow-up's brief opens, by how it was filed. */
const OPENING: Record<FiledWhen, (origin: IssueId) => string> = {
  passed: (origin) => `The reviews of ${origin} held these findings without blocking it, and it passed.`,
  accepted: (origin) =>
    `The reviews of ${origin} held these findings, and its regional manager accepted it as it is, every criterion passing, with the must-fixes that failed its last round unfixed (its decisions say why).`,
};

/** How the verifier's word on a finding reads, by how it was filed: an accepted round's must-fixes were anchored, failing it. */
const WORDS: Record<FiledWhen, string> = {
  passed: "confirmed at the reviewer's severity, or downgraded to the severity it names",
  accepted: "anchored to what it breaks, which failed the round; confirmed at the reviewer's severity; or downgraded to the severity it names",
};

function briefOf(origin: IssueId, findings: readonly Leftover[], when: FiledWhen): string {
  const each = findings.map((finding) => `- Round ${finding.round}: ${findingText(finding, "  ")}\n  The verifier: ${triageText(finding)}. ${finding.reason.replaceAll("\n", "\n  ")}`);
  return [
    `${OPENING[when](origin)} Each held when its round was verified, but a later round, or work merged since, may have fixed it: check that each still holds on the default branch before you change anything, and leave alone, saying so in your handoff, any that no longer does.`,
    `Each finding with the round that held it last, its place, the reviewer's severity and claim, then the verifier's word on it (${WORDS[when]}) and its reason:`,
    each.join("\n"),
  ].join("\n\n");
}

/** A title on one line, cut with an ellipsis to the characters an issue's title holds (issue.ts MAX_TITLE_CHARS). */
function oneTitle(title: string): string {
  const line = title.replaceAll(/\s+/g, " ").trim();
  return line.length <= MAX_TITLE_CHARS ? line : `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
}

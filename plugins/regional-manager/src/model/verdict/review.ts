// A done handoff's review: before its verifier starts, an independent reviewer reads the diff as
// the regional manager's CREW.md instructs reviewers, and reports findings, each at a place in the
// diff with a severity and its claim. The verifier then triages each one, rejected, confirmed,
// anchored to what it breaks, or downgraded, with a reason, beside its own check of the
// done-criteria. The plugin names no review of its own: what the reviewer looks for is CREW.md's,
// and what blocks is the anchor rule's (ANCHOR_RULE). A review is stored on its check, beside the
// verdict; while the verdict is queued and the review is to come, the issue is Reviewing.
import { z } from "zod";
import { modelRefSchema } from "../agent/execution.ts";
import type { Verdict } from "./verdict.ts";

/** How much a finding matters, by the reviewer's judgement: must-fix, should-fix, or a nit. */
export const severitySchema = z.enum(["must-fix", "should-fix", "nit"]);
type Severity = z.infer<typeof severitySchema>;

/** One thing the reviewer found: where in the diff (its file, and its line, null when it names none), how much it matters, and what it claims is wrong. */
export const reviewFindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().min(1).nullable(),
  severity: severitySchema,
  claim: z.string().min(1),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

const reviewerThreadIdSchema = z.string().min(1);

/**
 * Where a check's review stands. `none`: the check has no review stage, as a final check, one made
 * while verification was off or of a checkout bb's git plugin couldn't read, and one made before
 * reviews existed. `queued`: its reviewer starts once the agent's thread is idle. `running`: a
 * reviewer thread reviews.
 * `reported`: it returned its findings ([] for none), on the model bb ran it on. `missed`: no
 * review was had, and why; its thread, if it had one. Verification goes ahead either way. Each of
 * the two keeps `at`, when it came (the migration gave every one stored before a time).
 */
export const reviewSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({ state: z.literal("queued") }),
  z.object({ state: z.literal("running"), reviewerThreadId: reviewerThreadIdSchema }),
  z.object({ state: z.literal("reported"), at: z.number(), reviewerThreadId: reviewerThreadIdSchema, findings: z.array(reviewFindingSchema), model: modelRefSchema }),
  z.object({ state: z.literal("missed"), at: z.number(), reviewerThreadId: reviewerThreadIdSchema.nullable(), reason: z.string() }),
]);
export type Review = z.infer<typeof reviewSchema>;

/**
 * What a must-fix can break, which is what lets it block the work: a done-criterion, the issue's
 * brief text, a decision recorded on the issue, safety (data loss, a crash, a security hole), or
 * existing behaviour, as a regression.
 */
const anchorSchema = z.enum(["criterion", "brief", "decision", "safety", "regression"]);
type Anchor = z.infer<typeof anchorSchema>;

/** What each anchor names, in the words every place gives it: "it breaks <words>". */
const ANCHOR_WORDS: Record<Anchor, string> = {
  criterion: "a done-criterion",
  brief: "the issue's brief",
  decision: "a recorded decision",
  safety: "safety (data loss, a crash or a security hole)",
  regression: "existing behaviour, as a regression",
};

/**
 * What blocks the work, in the one wording each place a reviewer or a verifier reads gives it.
 * why the brief defined: a reviewer reviews as CREW.md instructs, so without it a CREW.md or
 * REVIEW.md rule would read as part of the brief.
 */
export const ANCHOR_RULE = `A must-fix blocks the work only when it breaks one of five things: ${anchorList()}. The brief is the issue's brief text: a CREW.md or REVIEW.md rule blocks only when the brief or a done-criterion names it. Work that follows a recorded decision is never a finding.`;

/**
 * The verifier's triage of one finding, as issue_verdict takes it and the check stores it, in the
 * review's order, each with why in a line: rejected, it doesn't hold or isn't worth fixing;
 * confirmed, a should-fix or nit that holds; anchored, a must-fix that holds and breaks `anchor`;
 * downgraded, one that holds at the lower severity `to`. why `common`: issue_verdict takes the
 * same variants with the finding's number beside them (verdict-tool.ts). Stored rows from before
 * the anchor rule are confirmed or rejected, and parse as they are.
 */
export const triageVariants = <Common extends z.ZodRawShape>(common: Common) =>
  z.discriminatedUnion("result", [
    z.object({ result: z.literal("rejected"), ...common }),
    z.object({ result: z.literal("confirmed"), ...common }),
    z.object({ result: z.literal("anchored"), anchor: anchorSchema, ...common }),
    z.object({ result: z.literal("downgraded"), to: severitySchema, ...common }),
  ]);
export const triageSchema = triageVariants({ reason: z.string().min(1) });
type Triage = z.infer<typeof triageSchema>;

/**
 * A finding of the reviewer's with the verifier's triage of it: the one shape a verdict's readers
 * get. why joined, never stored: the finding is stored once, on the review, and the store joins
 * them as it reads the check (verdict.ts withReview).
 */
export type Triaged = ReviewFinding & Triage;

/** How a verifier triages the reviewer's findings, and what its triage does, in the one wording each place a verifier reads gives it. */
export const TRIAGE_RULE = `Rejected: it doesn't hold, or isn't worth fixing. Confirmed: a should-fix or nit that holds. Anchored: a must-fix that holds and breaks one of the five things below; name which as its anchor. Downgraded: a finding that holds at a lower severity than the reviewer gave it, which you name as to: a must-fix that breaks none of the five is downgraded, never confirmed. Give each its reason in a line. Every finding that holds goes back to the agent in its automatic fix round; a rejected one never does. Only an anchored must-fix fails the verdict, as a failed criterion does, even when every criterion passes: anchor one only when what you ran or read shows it holds and breaks what you name. ${ANCHOR_RULE}`;

/**
 * Why a verifier's triage of a finding can't be taken, in a phrase; null when it can: a must-fix
 * that holds is anchored or downgraded, never just confirmed; only a must-fix is anchored; and a
 * downgrade goes lower than the reviewer's severity. The one rule issue_verdict checks each entry with.
 */
export function triageProblem({ severity }: ReviewFinding, triage: Triage): string | null {
  switch (triage.result) {
    case "rejected":
      return null;
    case "confirmed":
      return severity === "must-fix" ? "a must-fix that holds is anchored, naming what it breaks, or downgraded, never just confirmed" : null;
    case "anchored":
      return severity === "must-fix" ? null : `only a must-fix is anchored, and this one is a ${severity}: ${holdsAs(severity)}`;
    case "downgraded":
      return lowerThan(severity).includes(triage.to) ? null : `a downgrade goes lower than the reviewer's ${severity}, and ${triage.to} isn't: ${holdsAs(severity)}`;
    default:
      return triage satisfies never;
  }
}

/** Whether a finding held, as the verifier triaged it: every one it didn't reject. The one rule for what goes back to the agent and what a round counts as held. */
export function holds(triage: Triage): boolean {
  switch (triage.result) {
    case "rejected":
      return false;
    case "confirmed":
    case "anchored":
    case "downgraded":
      return true;
    default:
      return triage satisfies never;
  }
}

/** The verifier's word on a finding, in the one wording catch-up, a handed-over agent and the board give it: "Anchored, as it breaks the issue's brief", "Downgraded to should-fix". */
export function triageText(triage: Triage): string {
  switch (triage.result) {
    case "rejected":
      return "Rejected";
    case "confirmed":
      return "Confirmed";
    case "anchored":
      return `Anchored, as it breaks ${ANCHOR_WORDS[triage.anchor]}`;
    case "downgraded":
      return `Downgraded to ${triage.to}`;
    default:
      return triage satisfies never;
  }
}

/** The severities lower than `severity`, the most a finding can matter first. */
const lowerThan = (severity: Severity): Severity[] => severitySchema.options.slice(severitySchema.options.indexOf(severity) + 1);

/** How a finding of `severity` that holds can be triaged, as a refusal's way forward: a must-fix anchored, any other confirmed, or either downgraded when a lower severity exists. */
function holdsAs(severity: Severity): string {
  const keep = severity === "must-fix" ? "anchor it, naming what it breaks" : "confirm it";
  const lower = lowerThan(severity);
  return lower.length === 0 ? keep : `${keep}, or downgrade it to ${lower.join(" or ")}`;
}

/** The anchors as a list in a sentence: "a done-criterion, the issue's brief, …, or existing behaviour, as a regression". */
function anchorList(): string {
  const words = anchorSchema.options.map((anchor) => ANCHOR_WORDS[anchor]);
  return `${words.slice(0, -1).join(", ")}, or ${words.at(-1)}`;
}

/** The review a check starts with: queued for a reviewer when its verdict is queued for a verifier, else none. A final check's is none: it reviews no diff. */
export const firstReview = (verdict: Verdict): Review => (verdict.state === "queued" ? { state: "queued" } : { state: "none" });

/** Whether the review is still to come: its reviewer hasn't started, or hasn't reported. */
export const isReviewing = (review: Review): boolean => review.state === "queued" || review.state === "running";

/**
 * Whether the check waits on its review: its verdict is still queued and its review still to come.
 * why the verdict too: a check superseded mid-review keeps that review as it was, and none comes.
 * The one rule for an issue's Reviewing status and a round's Reviewing… score.
 */
export const reviewPending = ({ review, verdict }: { review: Review; verdict: Pick<Verdict, "state"> }): boolean => verdict.state === "queued" && isReviewing(review);

/**
 * Each finding the reviewer reported, with the verifier's triage of it (`triage`, in the
 * findings' order); [] when it reported none or none was had. why throw on a count that differs,
 * or on a triage the rule refuses for its finding's severity (triageProblem), as an anchored nit:
 * issue_verdict refuses both, and the two are stored together, so a stored check that breaks
 * either is refused as the store reads it, never read as failing a verdict it couldn't fail. A
 * confirmed must-fix passes: verdicts from before the anchor rule stored it so (verdict.ts
 * failsVerdict).
 */
export function triaged(review: Review, triage: readonly Triage[]): Triaged[] {
  const findings = review.state === "reported" ? review.findings : [];
  if (findings.length !== triage.length) throw new Error(`The verdict triages ${triage.length} of the review's ${findings.length} findings.`);
  return findings.map((finding, i) => {
    const one = at(triage, i);
    const problem = isLegacyConfirmed(finding, one) ? null : triageProblem(finding, one);
    if (problem !== null) throw new Error(`The verdict's triage of finding ${i + 1} breaks the triage rule: ${problem}.`);
    return { ...finding, ...one };
  });
}

/** A must-fix the verifier confirmed, as verdicts from before the anchor rule stored one. */
const isLegacyConfirmed = ({ severity }: ReviewFinding, { result }: Triage): boolean => severity === "must-fix" && result === "confirmed";

/** A finding in a line: its place, its severity, then its claim. */
export const findingText = (finding: ReviewFinding): string => `${placeText(finding)} (${finding.severity}): ${finding.claim}`;

/** Where in the diff a finding is, as code: its file, and its line when it names one. */
export const placeText = ({ file, line }: Pick<ReviewFinding, "file" | "line">): string => `\`${file}${line === null ? "" : `:${line}`}\``;

/** why throw: triaged checks the counts first. */
function at(triage: readonly Triage[], i: number): Triage {
  const one = triage[i];
  if (one === undefined) throw new Error(`No triage for finding ${i + 1}.`);
  return one;
}

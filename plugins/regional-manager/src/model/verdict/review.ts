// A done handoff's review: before its verifier starts, an independent reviewer reads the diff as
// the regional manager's CREW.md instructs reviewers, and reports findings, each at a place in the
// diff with a severity and its claim. The verifier then triages each one, confirmed or rejected
// with a reason, beside its own check of the done-criteria. The plugin names no review of its own:
// what the reviewer runs is CREW.md's. A review is stored on its check, beside the verdict; while
// the verdict is queued and the review is to come, the issue is Reviewing.
import { z } from "zod";
import { modelRefSchema } from "../agent/execution.ts";
import type { Verdict } from "./verdict.ts";

/** How much a finding matters, by the reviewer's judgement: must-fix, should-fix, or a nit. */
export const severitySchema = z.enum(["must-fix", "should-fix", "nit"]);

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

/** The verifier's triage of one finding: confirmed, it holds and is worth fixing; rejected, it doesn't or isn't; with why, in a line. */
export const triageSchema = z.object({ result: z.enum(["confirmed", "rejected"]), reason: z.string().min(1) });
export type Triage = z.infer<typeof triageSchema>;

/** A finding with the verifier's triage of it. */
type Triaged = ReviewFinding & Triage;

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
 * findings' order); [] when it reported none or none was had. why throw on a count that differs:
 * issue_verdict refuses a triage that doesn't take every finding once, and the two are stored together.
 */
export function triaged(review: Review, triage: readonly Triage[]): Triaged[] {
  const findings = review.state === "reported" ? review.findings : [];
  if (findings.length !== triage.length) throw new Error(`The verdict triages ${triage.length} of the review's ${findings.length} findings.`);
  return findings.map((finding, i) => ({ ...finding, ...at(triage, i) }));
}

/** A finding in a line: its place, its severity, then its claim. */
export const findingText = ({ file, line, severity, claim }: ReviewFinding): string => `\`${file}${line === null ? "" : `:${line}`}\` (${severity}): ${claim}`;

/** why throw: triaged checks the counts first. */
function at(triage: readonly Triage[], i: number): Triage {
  const one = triage[i];
  if (one === undefined) throw new Error(`No triage for finding ${i + 1}.`);
  return one;
}

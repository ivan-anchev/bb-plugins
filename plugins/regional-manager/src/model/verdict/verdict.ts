// A done handoff's verdict: whether the commit the agent claimed was what it left checked out, as the
// plugin read it, whether an independent verifier thread checked the work against each
// done-criterion, what it found, and how it triaged each of the reviewer's findings. Pass or fail
// is never stored: `judge` derives it, so the board, the catch-up and the doorbell can't disagree.
import { z } from "zod";
import { modelRefSchema } from "../agent/execution.ts";
import { headline } from "../one-line.ts";
import type { Check, CheckSubject } from "./check.ts";
import { blockingDefectSchema, holds, severitySchema, TITLE_CHARS, triaged, triageSchema, type ReviewFinding, type Triaged } from "./review.ts";
import { checkoutProblems, checkoutSchema, NOT_CLEAN, type Checkout, type CheckoutRead } from "./checkout.ts";
import { ciVerdictSchema, type Ci, type CiVerdict, type PrSnapshot } from "./pr.ts";

/** One done-criterion as the verifier judged it. why three: a criterion it couldn't check is not a pass. */
export const criterionResultSchema = z.enum(["pass", "fail", "unverifiable"]);
export type CriterionResult = z.infer<typeof criterionResultSchema>;

/**
 * What a verifier does with a criterion it can't check as it is written, in the one wording each
 * place a verifier reads gives it (QA Q1: a verifier passed a criterion on a nearby fact).
 */
export const UNCHECKABLE_RULE =
  "A criterion you can't check as it is written, as when it names a step that hasn't happened yet, is unverifiable, with why as its evidence: never pass it on a nearby fact you could check.";

/** How long a criterion's `shows` line is at most, as the feed shows it on one row; the length a criterion judged before it had one derives its own to (headline). */
export const SHOWS_CHARS = 140;

/**
 * One done-criterion as the verifier judged it: its text, its result, `shows`, what the run showed
 * in a line, and the evidence it ran. why derived: a criterion judged before `shows` existed has
 * none, so its evidence's first sentence stands in, once, here. issue_verdict takes it capped
 * (verdict-tool.ts).
 */
const judgedCriterionSchema = z
  .object({ criterion: z.string(), result: criterionResultSchema, shows: z.string().min(1).optional(), evidence: z.string() })
  .transform(({ shows, ...judged }) => ({ ...judged, shows: shows ?? headline(judged.evidence, SHOWS_CHARS) }));

/**
 * A problem the verifier found itself that no criterion covers and that meets no blocking anchor,
 * in the review finding's shape: its severity, by CREW.md's Reviewers section, its title and its
 * detail. It never fails the verdict; one that holds above a nit is filed with the issue's
 * follow-up (rounds/follow-up.ts). why a string: one stored before findings had a shape was free
 * prose, parsed once here (legacyFinding). issue_verdict takes it capped (verdict-tool.ts).
 */
const verifierFindingShape = z.object({ severity: severitySchema, title: z.string().min(1), detail: z.string().min(1) });
export type VerifierFinding = z.output<typeof verifierFindingShape>;
const verifierFindingSchema = z.union([verifierFindingShape, z.string().min(1).transform(legacyFinding)]);

/**
 * A finding stored as free prose: titled by its first sentence, whole as its detail, at the first
 * severity its words name (the tool asked for one in them); should-fix when they name none, as a
 * finding that meets no anchor is at most that.
 */
function legacyFinding(text: string): VerifierFinding {
  const named = /\b(must-fix|should-fix|nit)\b/i.exec(text)?.[1];
  return { severity: named === undefined ? "should-fix" : severitySchema.parse(named.toLowerCase()), title: headline(text, TITLE_CHARS), detail: text };
}

/** A verifier's own finding in a line, as catch-up, the agent's fix round and the follow-up give it: its title and severity, then its detail, the detail's later lines indented by `indent`. */
export const verifierFindingText = ({ title, severity, detail }: VerifierFinding, indent = ""): string => `${title} (${severity}): ${detail.replaceAll("\n", `\n${indent}`)}`;

const verifierThreadIdSchema = z.string().min(1);

const roundSchema = z.number().int().min(1);

/** What CI said about the commit when the verdict settled. why a default: a verdict settled before CI was watched had none judged. */
const settledCiSchema = ciVerdictSchema.default({ kind: "none" });

/**
 * What became of a returned verdict. `pending`: nobody has been told yet; a failed one's findings
 * may be owed to the agent, sent once its verifier no longer runs. `waiting-for-ci`: it
 * passed all but CI, and CI on its commit is still to come. `sending-back`: its findings are
 * on their way to the agent as fix round `round`, already counted on the agent. `sent-back`: the
 * agent has them. `maybe-sent-back`: the plugin stopped while they were on their way, or the send
 * failed in a way that doesn't show whether bb took them, so it is final and its coordinating
 * thread's, with the round still spent. `checked`: it is final, and its coordinating thread's;
 * `refused` is bb's answer when it refused the findings sent back, else null. Each that settled
 * it keeps `ci`, what CI said about the commit then. `superseded`: it waited for CI when a newer
 * handoff or a handover replaced it, so it is final with no CI judged, and nobody is told.
 */
const pendingSchema = z.object({ kind: z.literal("pending") });
const waitingForCiSchema = z.object({ kind: z.literal("waiting-for-ci") });
const sendingBackSchema = z.object({ kind: z.literal("sending-back"), round: roundSchema, ci: settledCiSchema });
const sentBackSchema = z.object({ kind: z.literal("sent-back"), round: roundSchema, ci: settledCiSchema });
const maybeSentBackSchema = z.object({ kind: z.literal("maybe-sent-back"), round: roundSchema, ci: settledCiSchema });
const checkedSchema = z.object({ kind: z.literal("checked"), refused: z.string().nullable(), ci: settledCiSchema });
const supersededSettlementSchema = z.object({ kind: z.literal("superseded") });
const settlementSchema = z.discriminatedUnion("kind", [
  pendingSchema,
  waitingForCiSchema,
  sendingBackSchema,
  sentBackSchema,
  maybeSentBackSchema,
  checkedSchema,
  supersededSettlementSchema,
]);

/**
 * The verifier's verdict on the commit `headSha` (the agent's claim; for a final check, the one its
 * own worktree held as it returned) and `checkout`, bb's read of the tree it was judged in: each
 * criterion in the issue's order, and the model bb ran it on. `sameModel`: no other model was
 * available, so it ran on the model of an agent whose work it checks. `mustFixFails`: whether a
 * must-fix finding the verifier confirmed fails it (failsVerdict), true for every verdict
 * returned since that rule; false for one settled before it, which keeps the outcome it settled
 * with (migrations.ts). Since the anchor rule a must-fix is never confirmed, so it reads only on
 * verdicts from before.
 * why the defaults: a verdict stored before settlements existed was settled as it was stored, and
 * one stored before reviews existed triaged none.
 */
const returnedSchema = z.object({
  state: z.literal("returned"),
  /** When it returned. why required: the migration gave every one stored before a time (its announcing event's, else its check's). */
  at: z.number(),
  verifierThreadId: verifierThreadIdSchema,
  headSha: z.string(),
  checkout: checkoutSchema,
  criteria: z.array(judgedCriterionSchema).min(1),
  findings: z.array(verifierFindingSchema),
  /** The defects the verifier found itself, outside the criteria, that meet a blocking anchor: each one fails the verdict. why the default: a verdict stored before d68 reported none. */
  blocking: z.array(blockingDefectSchema).default([]),
  /** The verifier's triage of each of the review's findings, in their order: only its triage, as the findings are the review's. */
  triage: z.array(triageSchema).default([]),
  mustFixFails: z.boolean(),
  model: modelRefSchema,
  sameModel: z.boolean(),
  settlement: settlementSchema.default({ kind: "checked", refused: null, ci: { kind: "none" } }),
});

// Each state up to a returned verdict keeps `checkout`, the agent's environment as bb's git plugin
// read it when the agent handed off; null for a final check, whose verifier's own worktree is read
// when it returns.
const pendingCheckoutSchema = checkoutSchema.nullable();
/** Verification is on and no verifier has started yet. */
const queuedSchema = z.object({ state: z.literal("queued"), checkout: pendingCheckoutSchema });
/**
 * A verifier thread is checking; `nudged` once it went idle without a verdict and was asked again;
 * `declined`, what its provider asked a person that the plugin declined, as nobody answers a verifier.
 */
const runningSchema = z.object({
  state: z.literal("running"),
  verifierThreadId: verifierThreadIdSchema,
  nudged: z.boolean(),
  declined: z.array(z.string()).default([]),
  checkout: pendingCheckoutSchema,
});
/** No verdict will come: bb's git plugin couldn't read the agent's environment, or the verifier never started or stopped without one; since `at`. Its thread, if it had one. */
const couldNotRunSchema = z.object({ state: z.literal("could-not-run"), at: z.number(), verifierThreadId: verifierThreadIdSchema.nullable(), reason: z.string() });
/** A newer done handoff from the same agent, or a handover, replaced this one before its verdict. */
const supersededSchema = z.object({ state: z.literal("superseded") });
/** Verification was off when the agent handed off. */
const waivedSchema = z.object({ state: z.literal("waived") });

/** A verdict as the check stores it; the store reads it with the findings its verifier triaged (withReview). */
export const storedVerdictSchema = z.discriminatedUnion("state", [queuedSchema, runningSchema, returnedSchema, couldNotRunSchema, supersededSchema, waivedSchema]);
export type StoredVerdict = z.infer<typeof storedVerdictSchema>;

/** A verdict as its readers get it: a returned one's triage joined with the review's findings, each finding with the verifier's triage of it. */
export type Verdict = Exclude<StoredVerdict, { state: "returned" }> | (Omit<Extract<StoredVerdict, { state: "returned" }>, "triage"> & { triage: Triaged[] });

/** A stored verdict as its readers get it (Verdict), joined at the store's boundary with `findings`, the check's list its verifier triaged (rounds/delta.ts). */
export function withReview(verdict: StoredVerdict, findings: readonly ReviewFinding[]): Verdict {
  if (verdict.state !== "returned") return verdict;
  return { ...verdict, triage: triaged(findings, verdict.triage) };
}

/**
 * What became of a returned verdict, as the board reads it: its kind and, once settled, CI. why
 * without the fix round and bb's refusal: they are the regional manager's, and the board shows neither.
 * why no CI while the findings are on their way back: the board shows that state as pending.
 */
const shownSettlementSchema = z.discriminatedUnion("kind", [
  pendingSchema,
  waitingForCiSchema,
  sendingBackSchema.omit({ round: true, ci: true }),
  sentBackSchema.omit({ round: true }),
  maybeSentBackSchema.omit({ round: true }),
  checkedSchema.omit({ refused: true }),
  supersededSettlementSchema,
]);

/** A returned verdict as it is shown (see shownVerdictSchema). */
const shownReturnedSchema = returnedSchema.omit({ model: true, triage: true, mustFixFails: true, settlement: true, at: true }).extend({ settlement: shownSettlementSchema });

/**
 * A verdict as the user is shown it: only what the board reads, the board's RPC payload. why
 * without the model, the triage or mustFixFails: the board shows none of them here (a round sends
 * its findings with their triage, and what failed it, round.ts); they stay with the plugin and the
 * regional manager. why no checkout before a verdict returns, nor a verifier's nudge: the board
 * shows neither. why no time: a round's verdict step carries it (round.ts).
 */
export const shownVerdictSchema = z.discriminatedUnion("state", [
  queuedSchema.omit({ checkout: true }),
  runningSchema.omit({ checkout: true, nudged: true, declined: true }),
  shownReturnedSchema,
  couldNotRunSchema.omit({ at: true }),
  supersededSchema,
  waivedSchema,
]);
export type ShownVerdict = z.infer<typeof shownVerdictSchema>;

/** The verdict as the user is shown it, at the board's RPC boundary. why parse: zod drops every key its schema doesn't name, so nothing else reaches the board. */
export const shownVerdict = (verdict: Verdict): ShownVerdict => shownVerdictSchema.parse(verdict);

/**
 * What a verdict says about the work. `pending`: no verdict yet, or one nobody has been told of.
 * `waiting-for-ci`: it passed all but CI, and waits for CI on its commit.
 * `unverified`: nobody checks it.
 */
export const outcomeSchema = z.enum(["pending", "waiting-for-ci", "pass", "fail", "could-not-run", "superseded", "unverified"]);
export type Outcome = z.infer<typeof outcomeSchema>;

/** A verdict a check can start with: never a returned one, so never one joined with its review's findings. */
export type FirstVerdict = Extract<Verdict, { state: "waived" | "queued" | "could-not-run" }>;

/**
 * The verdict a check starts with: waived while verification is off, else queued for a verifier. A
 * done handoff's is queued on the checkout read as it handed off (`read`); a checkout bb's git
 * plugin couldn't read can't be verified, and never counts as the agent's failure, so it goes to
 * the coordinating thread as it is, at `at`, without a verifier or a fix round. A final check's (`read`
 * null) is never refused here: its verifier's worktree is read when it returns.
 */
export function firstVerdict(verifies: boolean, read: CheckoutRead | null, at: number): FirstVerdict {
  if (!verifies) return { state: "waived" };
  if (read === null) return { state: "queued", checkout: null };
  if (read.kind === "unread") return { state: "could-not-run", at, verifierThreadId: null, reason: `bb's git plugin couldn't read the agent's commit and working tree as it handed off (${read.reason})` };
  return { state: "queued", checkout: read.checkout };
}

export function outcome(verdict: Verdict): Outcome {
  switch (verdict.state) {
    case "queued":
    case "running":
      return "pending";
    case "returned": {
      if (verdict.settlement.kind === "superseded") return "superseded";
      const ci = ciVerdictOf(verdict);
      if (ci !== null) return judge(verdict, ci);
      // why pending until settled: the row says Verifying until the findings reach the agent or the verdict is final.
      return verdict.settlement.kind === "waiting-for-ci" ? "waiting-for-ci" : "pending";
    }
    case "could-not-run":
      return "could-not-run";
    case "superseded":
      return "superseded";
    case "waived":
      return "unverified";
    default:
      return verdict satisfies never;
  }
}

/**
 * Whether the check is in flight: its verdict is still to come (its review first, while it is
 * queued; then a verifier, or returned and nobody told), or it waits for CI. why by the verdict
 * alone: a review is to come only while its verdict is queued, and a check superseded mid-review
 * keeps that review as it was. A round reads it.
 */
export function checkInFlight({ verdict }: Pick<Check, "verdict">): boolean {
  const result = outcome(verdict);
  return result === "pending" || result === "waiting-for-ci";
}

/** A returned verdict as the plugin holds it: its review's findings each with the verifier's triage. */
type Returned = Extract<Verdict, { state: "returned" }>;

/** A returned verdict as either side has it, the plugin's or the board's (shown): what a rule that doesn't read its findings reads. */
type EitherReturned = Extract<ShownVerdict, { state: "returned" }>;

/**
 * The one rule for pass or fail: the claimed commit was checked out on a clean tree, every
 * criterion passed, no finding of the reviewer's fails it (failsVerdict), the verifier found no
 * blocking defect of its own, and CI on the
 * commit didn't fail. It waits while CI is still to come; CI that couldn't be checked, or that
 * reported no checks, is not a failure.
 */
export function judge(verdict: Returned, ci: Ci): "pass" | "fail" | "waiting-for-ci" {
  if (failureReasons(verdict, ci.kind === "waiting" ? null : ci).length > 0) return "fail";
  return ci.kind === "waiting" ? "waiting-for-ci" : "pass";
}

/**
 * Why a returned verdict failed: its checkout wasn't the claimed commit on a clean tree; `failed`
 * of its `of` criteria didn't pass; `count` of the reviewer's findings fail it on their own
 * (failsVerdict); `count` defects the verifier found itself meet a blocking anchor; CI failed on
 * pull request `number`.
 */
export type FailureReason =
  | { kind: "checkout" }
  | { kind: "criteria"; failed: number; of: number }
  | { kind: "must-fix"; count: number }
  | { kind: "defect"; count: number }
  | { kind: "ci"; number: number };

/**
 * Why a returned verdict failed, in the order every surface reads them, CI as `ci` says (by
 * default, what it settled with). [] when nothing it has been judged on failed it.
 */
export function failureReasons(verdict: Returned, ci: CiVerdict | null = ciVerdictOf(verdict)): FailureReason[] {
  const failed = verdict.criteria.filter((check) => check.result !== "pass").length;
  const mustFix = failingFindings(verdict).length;
  const reasons: FailureReason[] = [];
  if (failedCheckout(verdict) !== null) reasons.push({ kind: "checkout" });
  if (failed > 0) reasons.push({ kind: "criteria", failed, of: verdict.criteria.length });
  if (mustFix > 0) reasons.push({ kind: "must-fix", count: mustFix });
  if (verdict.blocking.length > 0) reasons.push({ kind: "defect", count: verdict.blocking.length });
  if (ci?.kind === "fail") reasons.push({ kind: "ci", number: ci.number });
  return reasons;
}

/** What failed a verdict first (failureReasons): the one order the issue's headline and its round name it by; null when nothing failed it, or it hasn't returned. */
export const firstFailure = (verdict: Verdict): FailureReason | null => (verdict.state === "returned" ? (failureReasons(verdict)[0] ?? null) : null);

/**
 * Whether a verdict failed on review findings alone: it failed, and every reason is the reviewer's
 * must-fix findings that fail it (failsVerdict), so every criterion passed, the claimed commit was
 * on a clean tree, the verifier found no blocking defect of its own, and CI didn't fail. The one
 * rule the manager's accept (issues.ts) and catch-up read.
 */
export function failedOnReviewOnly(verdict: Verdict): boolean {
  if (verdict.state !== "returned" || outcome(verdict) !== "fail") return false;
  return failureReasons(verdict).every(({ kind }) => kind === "must-fix");
}

/** Whether CI failed on the commit a check of a done handoff judged, as its pull request was last read (`pr`, null: none read). */
export const ciFailedAt = (subject: CheckSubject, pr: Pick<PrSnapshot, "headSha" | "ci"> | null): boolean =>
  subject.kind === "handoff" && pr !== null && pr.headSha === subject.headSha && pr.ci === "fail";

/** A branch's pull request as the PR watch last read it (null: none read). */
export type PrOfBranch = (branch: string) => PrSnapshot | null;

/**
 * The pull request of the work a check judged: the one on the branch its agent handed off on
 * (check.ts), as last read (`prOf`). why never the issue's: an agent started clean since may work
 * on another branch, whose pull request isn't this work's. null: a final check, a handoff on no
 * branch, or none read.
 */
export const checkedPr = (subject: CheckSubject, prOf: PrOfBranch): PrSnapshot | null => (subject.kind === "handoff" && subject.branch !== null ? prOf(subject.branch) : null);

/**
 * Whether the manager may accept a check as it is (issues.ts acceptEdit): its verdict failed on
 * review findings alone, and CI didn't fail on its commit as its work's pull request was last read
 * (checkedPr). The one eligibility rule the accept, catch-up and the cap question's merge answer read.
 */
export const acceptableAsIs = ({ verdict, subject }: Pick<Check, "verdict" | "subject">, prOf: PrOfBranch): boolean =>
  failedOnReviewOnly(verdict) && !ciFailedAt(subject, checkedPr(subject, prOf));

/**
 * Whether a finding fails its verdict on its own: the verifier anchored it to what it breaks, or,
 * on a verdict from before the anchor rule, confirmed it as a must-fix while that rule
 * (`mustFixFails`) held. Should-fix and nit findings never do. The one failing rule.
 */
const failsVerdict = (finding: Triaged, mustFixFails: boolean): boolean =>
  finding.result === "anchored" || (mustFixFails && finding.result === "confirmed" && finding.severity === "must-fix");

/** The findings that fail the verdict on their own (failsVerdict). */
const failingFindings = (verdict: Returned): Returned["triage"] => verdict.triage.filter((finding) => failsVerdict(finding, verdict.mustFixFails));

/** The findings that held, every one the verifier didn't reject, in their order: `failing`, those that fail the verdict on their own (failsVerdict), and the `others`, downgraded ones included. */
export function heldFindings(verdict: Returned): { failing: Returned["triage"]; others: Returned["triage"] } {
  const failing = failingFindings(verdict);
  return { failing, others: verdict.triage.filter((finding) => holds(finding) && !failing.includes(finding)) };
}

/** A reason besides the criteria, which each place words in its own count. */
type ReasonBesidesCriteria = Exclude<FailureReason, { kind: "criteria" }>;

/** Whether a reason is one besides the criteria. */
const besidesCriteria = (reason: FailureReason): reason is ReasonBesidesCriteria => reason.kind !== "criteria";

/** What a check judged (check.ts): an agent's done handoff, or a build parent's final check. */
type Judged = CheckSubject["kind"];

/**
 * A reason a verdict failed besides its criteria, as a lower-case phrase every place gives it.
 * `judged`: what the check judged, an agent's done handoff or a final check's worktree.
 */
export function failureText(reason: ReasonBesidesCriteria, judged: Judged): string {
  switch (reason.kind) {
    case "checkout":
      return judged === "handoff" ? NOT_CLEAN.toLowerCase() : "the verifier's worktree wasn't clean";
    case "must-fix":
      return reason.count === 1 ? "a must-fix review finding upheld" : `${reason.count} must-fix review findings upheld`;
    case "defect":
      return reason.count === 1 ? "a blocking defect the verifier found" : `${reason.count} blocking defects the verifier found`;
    case "ci":
      return `CI failed on #${reason.number}`;
    default:
      return reason satisfies never;
  }
}

/** How a failed handoff's verdict reads, leading its headline: by the first of its reasons (firstFailure), so by its criteria only when nothing read before them failed it. */
export function failureHeadline(verdict: Verdict): string {
  const first = firstFailure(verdict);
  if (first === null || first.kind === "criteria") return "✗ Failed verification";
  const words = failureText(first, "handoff");
  return `✗ ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** Each reason a verdict failed besides its criteria (`reasons`, failureReasons), as its phrase (failureText), in order. */
export const failurePhrases = (reasons: readonly FailureReason[], judged: Judged): string[] =>
  reasons.filter(besidesCriteria).map((reason) => failureText(reason, judged));

/** The plugin's read of the checkout when it wasn't the claimed commit on a clean tree, which fails the verdict; null when it was. */
export function failedCheckout(verdict: EitherReturned): Checkout | null {
  const { headSha, checkout } = verdict;
  return checkoutProblems(headSha, checkout).length > 0 ? checkout : null;
}

/** What CI said about a settled verdict's commit; null while it is not settled, or when it was superseded before CI was judged. */
export function ciVerdictOf(verdict: EitherReturned): CiVerdict | null {
  const { settlement } = verdict;
  switch (settlement.kind) {
    case "pending":
    case "waiting-for-ci":
    case "sending-back":
    case "superseded":
      return null;
    case "sent-back":
    case "maybe-sent-back":
    case "checked":
      return settlement.ci;
    default:
      return settlement satisfies never;
  }
}

/** Whether a returned verdict is final: its findings reached the agent, it is its coordinating thread's, or it was superseded. why by its CI otherwise: every other settled verdict keeps one. */
export const isSettled = (verdict: EitherReturned): boolean => verdict.settlement.kind === "superseded" || ciVerdictOf(verdict) !== null;

/** Whether a verdict's findings may or may not have reached its agent (see `maybe-sent-back`). */
export const mayHaveReachedAgent = (verdict: Verdict): boolean => verdict.state === "returned" && verdict.settlement.kind === "maybe-sent-back";

import { z } from "zod";
import { checkoutProblems, checkoutSchema, type Checkout, type CheckoutRead } from "./checkout.ts";
import { ciVerdictSchema, type Ci, type CiVerdict } from "./pr.ts";

/** One done-criterion as the verifier judged it. why three: a criterion it couldn't check is not a pass. */
export const criterionResultSchema = z.enum(["pass", "fail", "unverifiable"]);
export type CriterionResult = z.infer<typeof criterionResultSchema>;

/**
 * What a verifier does with a criterion it can't check as it is written, in the one wording each
 * place a verifier reads gives it (QA Q1: a verifier passed a criterion on a nearby fact).
 */
export const UNCHECKABLE_RULE =
  "A criterion you can't check as it is written, as when it names a step that hasn't happened yet, is unverifiable, with why as its evidence: never pass it on a nearby fact you could check.";

const modelRefSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1) });

const verifierThreadIdSchema = z.string().min(1);

const roundSchema = z.number().int().min(1);

const settledCiSchema = ciVerdictSchema.default({ kind: "none" });

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

const returnedSchema = z.object({
  state: z.literal("returned"),
  verifierThreadId: verifierThreadIdSchema,
  headSha: z.string(),
  checkout: checkoutSchema,
  criteria: z.array(z.object({ criterion: z.string(), result: criterionResultSchema, evidence: z.string() })).min(1),
  findings: z.array(z.string()),
  model: modelRefSchema,
  sameModel: z.boolean(),
  settlement: settlementSchema.default({ kind: "checked", refused: null, ci: { kind: "none" } }),
});

const pendingCheckoutSchema = checkoutSchema.nullable();
const queuedSchema = z.object({ state: z.literal("queued"), checkout: pendingCheckoutSchema });
const runningSchema = z.object({
  state: z.literal("running"),
  verifierThreadId: verifierThreadIdSchema,
  nudged: z.boolean(),
  declined: z.array(z.string()).default([]),
  checkout: pendingCheckoutSchema,
});
const couldNotRunSchema = z.object({ state: z.literal("could-not-run"), verifierThreadId: verifierThreadIdSchema.nullable(), reason: z.string() });
const supersededSchema = z.object({ state: z.literal("superseded") });
const waivedSchema = z.object({ state: z.literal("waived") });

export const verdictSchema = z.discriminatedUnion("state", [queuedSchema, runningSchema, returnedSchema, couldNotRunSchema, supersededSchema, waivedSchema]);
export type Verdict = z.infer<typeof verdictSchema>;

const shownSettlementSchema = z.discriminatedUnion("kind", [
  pendingSchema,
  waitingForCiSchema,
  sendingBackSchema.omit({ round: true, ci: true }),
  sentBackSchema.omit({ round: true }),
  maybeSentBackSchema.omit({ round: true }),
  checkedSchema.omit({ refused: true }),
  supersededSettlementSchema,
]);

/**
 * A verdict as the user is shown it: only what the board reads. why without the model: the board
 * names no model; it stays with the plugin and the regional manager. why no checkout before a
 * verdict returns, nor a verifier's nudge: the board shows neither.
 */
export const shownVerdictSchema = z.discriminatedUnion("state", [
  queuedSchema.omit({ checkout: true }),
  runningSchema.omit({ checkout: true, nudged: true, declined: true }),
  returnedSchema.omit({ model: true, settlement: true }).extend({ settlement: shownSettlementSchema }),
  couldNotRunSchema,
  supersededSchema,
  waivedSchema,
]);
export type ShownVerdict = z.infer<typeof shownVerdictSchema>;

/** The verdict as the user is shown it. why parse: zod drops every key its schema doesn't name, so nothing else reaches the board. */
export const shownVerdict = (verdict: Verdict): ShownVerdict => shownVerdictSchema.parse(verdict);

/**
 * What a verdict says about the work. `pending`: no verdict yet, or one nobody has been told of.
 * `waiting-for-ci`: it passed every criterion, and waits for CI on its commit. `unverified`: nobody
 * checks it.
 */
type Outcome = "pending" | "waiting-for-ci" | "pass" | "fail" | "could-not-run" | "superseded" | "unverified";

/**
 * The verdict a check starts with: waived while verification is off, else queued for a verifier. A
 * done handoff's is queued on the checkout read as it handed off (`read`); a checkout bb's git
 * plugin couldn't read can't be verified, and never counts as the agent's failure, so it goes to
 * the coordinating thread as it is, without a verifier or a fix round. A final check's (`read`
 * null) is never refused here: its verifier's worktree is read when it returns.
 */
export function firstVerdict(verifies: boolean, read: CheckoutRead | null): Verdict {
  if (!verifies) return { state: "waived" };
  if (read === null) return { state: "queued", checkout: null };
  if (read.kind === "unread") return { state: "could-not-run", verifierThreadId: null, reason: `bb's git plugin couldn't read the agent's commit and working tree as it handed off (${read.reason})` };
  return { state: "queued", checkout: read.checkout };
}

export function outcome(verdict: ShownVerdict): Outcome {
  switch (verdict.state) {
    case "queued":
    case "running":
      return "pending";
    case "returned": {
      if (verdict.settlement.kind === "superseded") return "superseded";
      const ci = ciVerdictOf(verdict);
      if (ci !== null) return judge(verdict, ci);
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

/** A returned verdict, the model it ran on aside: what pass or fail is judged on. */
type Returned = Extract<ShownVerdict, { state: "returned" }>;

/**
 * The one rule for pass or fail: the claimed commit was checked out on a clean tree, every
 * criterion passed, and CI on the commit didn't fail. It waits while CI is still to come; CI that
 * couldn't be checked, or that reported no checks, is not a failure.
 */
export function judge(verdict: Returned, ci: Ci): "pass" | "fail" | "waiting-for-ci" {
  if (!allPassed(verdict)) return "fail";
  if (ci.kind === "waiting") return "waiting-for-ci";
  return ci.kind === "fail" ? "fail" : "pass";
}

/** Whether the checkout was as claimed and the verifier passed every criterion, whatever has become of its verdict since. */
export const allPassed = (verdict: Returned): boolean => failedCheckout(verdict) === null && verdict.criteria.every((check) => check.result === "pass");

/** The plugin's read of the checkout when it wasn't the claimed commit on a clean tree, which fails the verdict; null when it was. */
export function failedCheckout(verdict: Returned): Checkout | null {
  const { headSha, checkout } = verdict;
  return checkoutProblems(headSha, checkout).length > 0 ? checkout : null;
}

/** What CI said about a settled verdict's commit; null while it is not settled, or when it was superseded before CI was judged. */
export function ciVerdictOf(verdict: Returned): CiVerdict | null {
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
export const isSettled = (verdict: Returned): boolean => verdict.settlement.kind === "superseded" || ciVerdictOf(verdict) !== null;

/** Whether a verdict's findings may or may not have reached its agent (see `maybe-sent-back`). */
export const mayHaveReachedAgent = (verdict: Verdict): boolean => verdict.state === "returned" && verdict.settlement.kind === "maybe-sent-back";

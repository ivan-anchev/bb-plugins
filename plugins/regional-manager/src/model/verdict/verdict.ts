// A done handoff's verdict: whether the commit the agent claimed was what it left checked out, as the
// plugin read it, whether an independent verifier thread checked the work against each
// done-criterion, and what it found. Pass or fail is never stored: `judge` derives it, so the
// board, the catch-up and the doorbell can't disagree.
import { z } from "zod";
import { checkoutProblems, checkoutSchema, type Checkout, type CheckoutRead } from "./checkout.ts";
import { ciVerdictSchema, type Ci, type CiVerdict } from "./pr.ts";

/** One done-criterion as the verifier judged it. why three: a criterion it couldn't check is not a pass. */
export const criterionResultSchema = z.enum(["pass", "fail", "unverifiable"]);
export type CriterionResult = z.infer<typeof criterionResultSchema>;

/** A provider and model as bb records a thread's turns on them. */
const modelRefSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1) });
export type ModelRef = z.infer<typeof modelRefSchema>;

const verifierThreadIdSchema = z.string().min(1);

const roundSchema = z.number().int().min(1);

/** What CI said about the commit when the verdict settled. why a default: a verdict settled before CI was watched had none judged. */
const settledCiSchema = ciVerdictSchema.default({ kind: "none" });

/**
 * What became of a returned verdict. `pending`: nobody has been told yet. `waiting-for-ci`: it
 * passed every criterion, and CI on its commit is still to come. `sending-back`: its findings are
 * on their way to the agent as fix round `round`, already counted on the agent. `sent-back`: the
 * agent has them. `maybe-sent-back`: the plugin stopped while they were on their way, or the send
 * failed in a way that doesn't show whether bb took them, so it is final and its coordinating
 * thread's, with the round still spent. `checked`: it is final, and its coordinating thread's;
 * `refused` is bb's answer when it refused the findings sent back, else null. Each that settled
 * it keeps `ci`, what CI said about the commit then.
 */
const pendingSchema = z.object({ kind: z.literal("pending") });
const waitingForCiSchema = z.object({ kind: z.literal("waiting-for-ci") });
const sendingBackSchema = z.object({ kind: z.literal("sending-back"), round: roundSchema, ci: settledCiSchema });
const sentBackSchema = z.object({ kind: z.literal("sent-back"), round: roundSchema, ci: settledCiSchema });
const maybeSentBackSchema = z.object({ kind: z.literal("maybe-sent-back"), round: roundSchema, ci: settledCiSchema });
const checkedSchema = z.object({ kind: z.literal("checked"), refused: z.string().nullable(), ci: settledCiSchema });
const settlementSchema = z.discriminatedUnion("kind", [pendingSchema, waitingForCiSchema, sendingBackSchema, sentBackSchema, maybeSentBackSchema, checkedSchema]);

/**
 * The verifier's verdict on the claimed commit `headSha`: each criterion in the issue's order, and
 * the model bb ran it on. `sameModel`: no other model was available, so it ran on the agent's own.
 * why a default: a verdict stored before settlements existed was settled as it was stored.
 */
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

// Each state up to a returned verdict keeps `checkout`, the agent's environment as bb's git plugin read it when the agent handed off.
/** Verification is on and no verifier has started yet. */
const queuedSchema = z.object({ state: z.literal("queued"), checkout: checkoutSchema });
/** A verifier thread is checking; `nudged` once it went idle without a verdict and was asked again. */
const runningSchema = z.object({ state: z.literal("running"), verifierThreadId: verifierThreadIdSchema, nudged: z.boolean(), checkout: checkoutSchema });
/** No verdict will come: bb's git plugin couldn't read the agent's environment, or the verifier never started or stopped without one. Its thread, if it had one. */
const couldNotRunSchema = z.object({ state: z.literal("could-not-run"), verifierThreadId: verifierThreadIdSchema.nullable(), reason: z.string() });
/** A newer done handoff from the same agent replaced this one before its verdict. */
const supersededSchema = z.object({ state: z.literal("superseded") });
/** Verification was off when the agent handed off. */
const waivedSchema = z.object({ state: z.literal("waived") });

export const verdictSchema = z.discriminatedUnion("state", [queuedSchema, runningSchema, returnedSchema, couldNotRunSchema, supersededSchema, waivedSchema]);
export type Verdict = z.infer<typeof verdictSchema>;

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
]);

/**
 * A verdict as the user is shown it: only what the board reads. why without the model: the board
 * names no model; it stays with the plugin and the regional manager. why no checkout before a
 * verdict returns, nor a verifier's nudge: the board shows neither.
 */
export const shownVerdictSchema = z.discriminatedUnion("state", [
  queuedSchema.omit({ checkout: true }),
  runningSchema.omit({ checkout: true, nudged: true }),
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
 * The verdict a done handoff starts with: waived while verification is off, else queued for a
 * verifier on the checkout read. A checkout bb's git plugin couldn't read can't be verified, and
 * never counts as the agent's failure, so it goes to the coordinating thread as it is, without a
 * verifier or a fix round.
 */
export function firstVerdict(verifies: boolean, read: CheckoutRead): Verdict {
  if (!verifies) return { state: "waived" };
  if (read.kind === "unread") return { state: "could-not-run", verifierThreadId: null, reason: `bb's git plugin couldn't read the agent's commit and working tree as it handed off (${read.reason})` };
  return { state: "queued", checkout: read.checkout };
}

export function outcome(verdict: ShownVerdict): Outcome {
  switch (verdict.state) {
    case "queued":
    case "running":
      return "pending";
    case "returned": {
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

/** What CI said about a settled verdict's commit; null while it is not settled. */
export function ciVerdictOf(verdict: Returned): CiVerdict | null {
  const { settlement } = verdict;
  switch (settlement.kind) {
    case "pending":
    case "waiting-for-ci":
    case "sending-back":
      return null;
    case "sent-back":
    case "maybe-sent-back":
    case "checked":
      return settlement.ci;
    default:
      return settlement satisfies never;
  }
}

/** Whether a returned verdict is final: its findings reached the agent, or it is its coordinating thread's. why by its CI: every settled verdict keeps one. */
export const isSettled = (verdict: Returned): boolean => ciVerdictOf(verdict) !== null;

/** Whether a verdict's findings may or may not have reached its agent (see `maybe-sent-back`). */
export const mayHaveReachedAgent = (verdict: Verdict): boolean => verdict.state === "returned" && verdict.settlement.kind === "maybe-sent-back";

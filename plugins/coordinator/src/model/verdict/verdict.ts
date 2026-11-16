// A done handoff's verdict: whether an independent verifier thread checked the work against each
// done-criterion, and what it found. Pass or fail is never stored: `judge` derives it, so the
// board, the catch-up and the doorbell can't disagree.
import { z } from "zod";
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
 * on their way to the crew as fix round `round`, already counted on the crew. `sent-back`: the
 * crew has them. `maybe-sent-back`: the plugin stopped while they were on their way, or the send
 * failed in a way that doesn't show whether bb took them, so it is final and its coordinating
 * thread's, with the round still spent. `checked`: it is final, and its coordinating thread's;
 * `refused` is bb's answer when it refused the findings sent back, else null. Each that settled
 * it keeps `ci`, what CI said about the commit then.
 */
const settlementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("waiting-for-ci") }),
  z.object({ kind: z.literal("sending-back"), round: roundSchema, ci: settledCiSchema }),
  z.object({ kind: z.literal("sent-back"), round: roundSchema, ci: settledCiSchema }),
  z.object({ kind: z.literal("maybe-sent-back"), round: roundSchema, ci: settledCiSchema }),
  z.object({ kind: z.literal("checked"), refused: z.string().nullable(), ci: settledCiSchema }),
]);

export const verdictSchema = z.discriminatedUnion("state", [
  /** Verification is on and no verifier has started yet. */
  z.object({ state: z.literal("queued") }),
  /** A verifier thread is checking; `nudged` once it went idle without a verdict and was asked again. */
  z.object({ state: z.literal("running"), verifierThreadId: verifierThreadIdSchema, nudged: z.boolean() }),
  /**
   * The verifier's verdict: the commit it found checked out, each criterion in the crew's order, and
   * the model bb ran it on. `sameModel`: no other model was available, so it ran on the crew's own.
   * why a default: a verdict stored before settlements existed was settled as it was stored.
   */
  z.object({
    state: z.literal("returned"),
    verifierThreadId: verifierThreadIdSchema,
    headSha: z.string(),
    criteria: z.array(z.object({ criterion: z.string(), result: criterionResultSchema, evidence: z.string() })).min(1),
    findings: z.array(z.string()),
    model: modelRefSchema,
    sameModel: z.boolean(),
    settlement: settlementSchema.default({ kind: "checked", refused: null, ci: { kind: "none" } }),
  }),
  /** No verdict will come: the verifier never started, or stopped without one. Its thread, if it had one. */
  z.object({ state: z.literal("could-not-run"), verifierThreadId: verifierThreadIdSchema.nullable(), reason: z.string() }),
  /** A newer done handoff from the same crew replaced this one before its verdict. */
  z.object({ state: z.literal("superseded") }),
  /** Verification was off when the crew handed off. */
  z.object({ state: z.literal("waived") }),
]);
export type Verdict = z.infer<typeof verdictSchema>;

/**
 * What a verdict says about the work. `pending`: no verdict yet, or one nobody has been told of.
 * `waiting-for-ci`: it passed every criterion, and waits for CI on its commit. `unverified`: nobody
 * checks it.
 */
type Outcome = "pending" | "waiting-for-ci" | "pass" | "fail" | "could-not-run" | "superseded" | "unverified";

export function outcome(verdict: Verdict): Outcome {
  switch (verdict.state) {
    case "queued":
    case "running":
      return "pending";
    case "returned": {
      const ci = ciVerdictOf(verdict);
      if (ci !== null) return judge(verdict, ci);
      // why pending until settled: the row says Verifying until the findings reach the crew or the verdict is final.
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

type Returned = Extract<Verdict, { state: "returned" }>;

/**
 * The one rule for pass or fail: every criterion passed, and CI on the commit didn't fail. It waits
 * while CI is still to come; CI that couldn't be checked, or that reported no checks, is not a failure.
 */
export function judge(verdict: Returned, ci: Ci): "pass" | "fail" | "waiting-for-ci" {
  if (!allPassed(verdict)) return "fail";
  if (ci.kind === "waiting") return "waiting-for-ci";
  return ci.kind === "fail" ? "fail" : "pass";
}

/** Whether the verifier passed every criterion, whatever has become of its verdict since. */
export const allPassed = (verdict: Returned): boolean => verdict.criteria.every((check) => check.result === "pass");

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

/** Whether a returned verdict is final: its findings reached the crew, or it is its coordinating thread's. why by its CI: every settled verdict keeps one. */
export const isSettled = (verdict: Returned): boolean => ciVerdictOf(verdict) !== null;

/** Whether a verdict's findings may or may not have reached its crew (see `maybe-sent-back`). */
export const mayHaveReachedCrew = (verdict: Verdict): boolean => verdict.state === "returned" && verdict.settlement.kind === "maybe-sent-back";

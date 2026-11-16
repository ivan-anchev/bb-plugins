// A done handoff's verdict: whether an independent verifier thread checked the work against each
// done-criterion, and what it found. Pass or fail is never stored: `outcome` derives it, so the
// board, the catch-up and the doorbell can't disagree.
import { z } from "zod";

/** One done-criterion as the verifier judged it. why three: a criterion it couldn't check is not a pass. */
export const criterionResultSchema = z.enum(["pass", "fail", "unverifiable"]);
export type CriterionResult = z.infer<typeof criterionResultSchema>;

/** A provider and model as bb records a thread's turns on them. */
const modelRefSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1) });
export type ModelRef = z.infer<typeof modelRefSchema>;

const verifierThreadIdSchema = z.string().min(1);

export const verdictSchema = z.discriminatedUnion("state", [
  /** Verification is on and no verifier has started yet. */
  z.object({ state: z.literal("queued") }),
  /** A verifier thread is checking; `nudged` once it went idle without a verdict and was asked again. */
  z.object({ state: z.literal("running"), verifierThreadId: verifierThreadIdSchema, nudged: z.boolean() }),
  /**
   * The verifier's verdict: the commit it found checked out, each criterion in the crew's order, and
   * the model bb ran it on. `sameModel`: no other model was available, so it ran on the crew's own.
   */
  z.object({
    state: z.literal("returned"),
    verifierThreadId: verifierThreadIdSchema,
    headSha: z.string(),
    criteria: z.array(z.object({ criterion: z.string(), result: criterionResultSchema, evidence: z.string() })).min(1),
    findings: z.array(z.string()),
    model: modelRefSchema,
    sameModel: z.boolean(),
  }),
  /** No verdict will come: the verifier never started, or stopped without one. Its thread, if it had one. */
  z.object({ state: z.literal("could-not-run"), verifierThreadId: verifierThreadIdSchema.nullable(), reason: z.string() }),
  /** A newer done handoff from the same crew replaced this one before its verdict. */
  z.object({ state: z.literal("superseded") }),
  /** Verification was off when the crew handed off. */
  z.object({ state: z.literal("waived") }),
]);
export type Verdict = z.infer<typeof verdictSchema>;

/** What a verdict says about the work. `pending`: no verdict yet. `unverified`: nobody checks it. */
export type Outcome = "pending" | "pass" | "fail" | "could-not-run" | "superseded" | "unverified";

export function outcome(verdict: Verdict): Outcome {
  switch (verdict.state) {
    case "queued":
    case "running":
      return "pending";
    case "returned":
      return verdict.criteria.every((check) => check.result === "pass") ? "pass" : "fail";
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

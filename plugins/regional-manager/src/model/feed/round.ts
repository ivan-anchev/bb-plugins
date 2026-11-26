// A round: one attempt at an issue, from a handoff (or a build parent's final check) through its
// review and verdict to what became of it. Folded, it is a line and a score (Round, in the feed's
// spine); opened, it is the texts behind them (RoundBody, read per round with roundBodies). The two
// share no field: the split is where the wire divides what folds from what opens.
import { z } from "zod";
import { agentIdSchema } from "../agent/agent.ts";
import { decisionIdSchema, type DecisionId } from "../decision.ts";
import { handoffBody, handoffBodySchema, handoffIdSchema, handoffStatusSchema, type Handoff, type HandoffId } from "../agent/handoff.ts";
import { issueStatusSchema, type Handed } from "../issue/status.ts";
import { checkIdSchema, type Check, type CheckId, type FinalCheck } from "../verdict/check.ts";
import { holds, reviewFindingSchema, reviewPending, triageSchema, type Review } from "../verdict/review.ts";
import { checkInFlight, criterionResultSchema, firstFailure, outcome, outcomeSchema, shownVerdict, shownVerdictSchema, type CriterionResult, type Verdict } from "../verdict/verdict.ts";

/**
 * A round's address within its issue: `h-` and its handoff's id, or `f-` and its final check's. why
 * the id checked as the uuid it is: roundTarget parses it so, and a key that would fail there must
 * fail here, at the boundary, where one bad key of a batch reads null alone.
 */
export const roundKeySchema = z
  .string()
  .refine((key) => /^[hf]-/.test(key) && z.uuid().safeParse(key.slice(2)).success, "A round key is h- or f- and an id")
  .brand<"roundKey">();
export type RoundKey = z.infer<typeof roundKeySchema>;

/** What a round's key names: its handoff, or its final check. */
export function roundTarget(key: RoundKey): { kind: "handoff"; handoffId: HandoffId } | { kind: "final"; checkId: CheckId } {
  const id = key.slice(2);
  return key.startsWith("h-") ? { kind: "handoff", handoffId: handoffIdSchema.parse(id) } : { kind: "final", checkId: checkIdSchema.parse(id) };
}

/** A moment of a round: when it happened, and the status the plugin observed the issue move to after it (feed.ts attachStatuses; null: none). */
const stepSchema = z.object({ at: z.number(), moved: issueStatusSchema.nullable() });
export type Step = z.infer<typeof stepSchema>;

export const roundSchema = z.object({
  key: roundKeySchema,
  number: z.number().int().min(1),
  /** When it began: its handoff, or its final check. */
  handed: stepSchema,
  by: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("agent"), agentId: agentIdSchema, status: handoffStatusSchema, summary: z.string() }),
    z.object({ kind: z.literal("final"), defaultBranch: z.string() }),
  ]),
  /**
   * Its review: none (no review stage), still to come, missed (why is the body's), or reported with
   * how many findings and, once the verdict triaged them, how many held (every one not rejected:
   * anchored, downgraded or confirmed) and how many of those it downgraded, both null until then;
   * each that came, its step.
   */
  review: z.discriminatedUnion("state", [
    z.object({ state: z.literal("none") }),
    z.object({ state: z.literal("pending") }),
    z.object({ state: z.literal("missed"), step: stepSchema }),
    z.object({ state: z.literal("reported"), step: stepSchema, findings: z.number().int(), held: z.number().int().nullable(), downgraded: z.number().int().nullable() }),
  ]),
  /**
   * Its verdict (null: nothing checks this round, as a blocked or research handoff): what it says,
   * and, when it failed, what failed it first (verdict.ts firstFailure): its checkout (not the
   * claimed commit on a clean tree), a criterion, a must-fix finding the verifier anchored, or CI; each criterion's result in the check's order ([] until it returned), and the
   * fix round its findings went back to its agent as once settled (null: none):
   * reached it, or may have (the plugin can't tell, so the verdict is its manager's); when it
   * returned or could not run (null: neither yet, or it never will); and, on the one round whose
   * failure put the cap question to the user (rounds/cap.ts), that question's id (null on every
   * other round). why no count: the question, among the issue's decisions, carries its cap.
   */
  verdict: z
    .object({
      outcome: z.discriminatedUnion("kind", [z.object({ kind: z.literal("fail"), by: z.enum(["checkout", "criteria", "must-fix", "defect", "ci"]) }), z.object({ kind: outcomeSchema.exclude(["fail"]) })]),
      results: z.array(criterionResultSchema),
      fixRound: z.object({ round: z.number().int(), delivery: z.enum(["sent", "maybe"]) }).nullable(),
      step: stepSchema.nullable(),
      asked: decisionIdSchema.nullable(),
    })
    .nullable(),
  /** When its returned verdict was sent back or made final, from the inbox event that said so (null: not yet, or no verdict returned, which its verifier's step tells). */
  outcome: stepSchema.nullable(),
  /** Its check is in flight: its review, its verdict or CI is still to come. */
  inFlight: z.boolean(),
});
export type Round = z.infer<typeof roundSchema>;

export const roundBodySchema = z.object({
  /** The handoff's account (null: a final check's round, which has none). */
  handoff: handoffBodySchema.nullable(),
  verdict: shownVerdictSchema.nullable(),
  /**
   * The findings its verifier triages, each with where it comes from (new, missed or unfixed) and
   * the verifier's triage once its verdict returned (null triage before): rejected, confirmed,
   * anchored with what it breaks, or downgraded with its new severity. why no earlier answers and
   * no title: the tab shows neither.
   */
  findings: z.array(reviewFindingSchema.omit({ title: true }).extend({ triage: triageSchema.nullable() })),
  /** Why no review was had (null: one was, or none was asked for). */
  reviewMissed: z.string().nullable(),
});
export type RoundBody = z.infer<typeof roundBodySchema>;

/** The round a handoff and its check make, numbered `number`, its outcome announced at `outcomeAt` (null: not yet), and what its failure asked at the cap (null: nothing). */
export function roundOf({ handoff, check }: Handed, number: number, outcomeAt: number | null, asked: DecisionId | null): Round {
  return {
    key: roundKeySchema.parse(`h-${handoff.id}`),
    number,
    handed: stepAt(handoff.at),
    by: { kind: "agent", agentId: handoff.agentId, status: handoff.status, summary: handoff.summary },
    review: check === null ? { state: "none" } : reviewOf(check),
    verdict: check === null ? null : verdictOf(check.verdict, asked),
    outcome: check === null ? null : outcomeStep(check.verdict, outcomeAt),
    inFlight: check !== null && checkInFlight(check),
  };
}

/** A build parent's final check as a round. */
export function finalRoundOf(check: FinalCheck, number: number, outcomeAt: number | null): Round {
  return {
    key: roundKeySchema.parse(`f-${check.id}`),
    number,
    handed: stepAt(check.at),
    by: { kind: "final", defaultBranch: check.subject.defaultBranch },
    review: { state: "none" },
    verdict: verdictOf(check.verdict, null),
    outcome: outcomeStep(check.verdict, outcomeAt),
    inFlight: checkInFlight(check),
  };
}

/** What a round opens to: its handoff (null: a final check's round), and its check's verdict and the review's findings (null, none: nothing checks it). */
export function bodyOf(handoff: Handoff | null, check: Check | null): RoundBody {
  return {
    handoff: handoff === null ? null : handoffBody(handoff),
    verdict: check === null ? null : shownVerdict(check.verdict),
    findings: check === null ? [] : findingsOf(check),
    reviewMissed: check?.review.state === "missed" ? check.review.reason : null,
  };
}

/**
 * What a folded round says of its check: its criteria passed of how many, passed and settled; what
 * failed it, its criteria (with how many passed), its checkout or CI; the stage it is at while its
 * review, its verdict's settling or CI is to come; or why it has no verdict. null: nothing checks it.
 */
type Score =
  | { kind: "judged"; passed: number; of: number }
  | { kind: "failed"; by: "criteria"; passed: number; of: number }
  | { kind: "failed"; by: "checkout" | "must-fix" | "defect" | "ci" }
  | { kind: "pending"; stage: "reviewing" | "verifying" | "ci" }
  | { kind: "unjudged"; outcome: "could-not-run" | "superseded" | "unverified" }
  | null;

export function scoreOf({ review, verdict }: Pick<Round, "review" | "verdict">): Score {
  if (verdict === null) return null;
  if (review.state === "pending") return { kind: "pending", stage: "reviewing" };
  const { outcome, results } = verdict;
  const passed = results.filter((result) => result === "pass").length;
  // why its reason first: a checkout, an anchored must-fix finding, a blocking defect the verifier found or CI that failed it is why, however many criteria passed (verdict.ts firstFailure).
  if (outcome.kind === "fail" && outcome.by !== "criteria") return { kind: "failed", by: outcome.by };
  // why a failed criterion next: it has failed, however the verdict settles.
  if (passed < results.length) return { kind: "failed", by: "criteria", passed, of: results.length };
  switch (outcome.kind) {
    case "fail":
      return { kind: "failed", by: "criteria", passed, of: results.length };
    case "pass":
      return { kind: "judged", passed, of: results.length };
    case "could-not-run":
    case "superseded":
    case "unverified":
      return { kind: "unjudged", outcome: outcome.kind };
    // why not a pass yet: every criterion passed, but nobody has been told, or CI is still to come.
    case "pending":
      return { kind: "pending", stage: "verifying" };
    case "waiting-for-ci":
      return { kind: "pending", stage: "ci" };
    default:
      // why no score: the server may be newer than this bundle for a moment after an update.
      outcome satisfies never;
      return null;
  }
}

/** One criterion's row of the grid: its wording now, and each judged round's result on it (null: that round's check had no criterion at its place). */
export type GridRow = { criterion: string; cells: { round: number; result: CriterionResult | null }[] };

/**
 * The criteria × rounds grid: per criterion, by position, each round with a verdict's result. why
 * by position: a check copies its criteria, and a reworded one keeps its row; the round's body has
 * the wording that round judged.
 */
export function criteriaGrid(criteria: readonly string[], rounds: readonly Round[]): GridRow[] {
  const judged = rounds.flatMap(({ number, verdict }) => (verdict !== null && verdict.results.length > 0 ? [{ number, results: verdict.results }] : []));
  return criteria.map((criterion, i) => ({ criterion, cells: judged.map(({ number, results }) => ({ round: number, result: results[i] ?? null })) }));
}

function reviewOf({ review, verdict }: Check): Round["review"] {
  switch (review.state) {
    case "none":
      return { state: "none" };
    // why none once its verdict left queued: a check superseded mid-review keeps that review as it was, and none will come.
    case "queued":
    case "running":
      return reviewPending({ review, verdict }) ? { state: "pending" } : { state: "none" };
    case "missed":
      return { state: "missed", step: stepAt(review.at) };
    case "reported":
      return { state: "reported", step: stepAt(review.at), findings: review.findings.length, ...heldOf(verdict) };
    default:
      return review satisfies never;
  }
}

/** How many of the review's findings held, and how many of those the verifier downgraded; both null until its verdict triaged them. */
function heldOf(verdict: Verdict): Pick<Extract<Round["review"], { state: "reported" }>, "held" | "downgraded"> {
  if (verdict.state !== "returned") return { held: null, downgraded: null };
  return { held: verdict.triage.filter(holds).length, downgraded: verdict.triage.filter(({ result }) => result === "downgraded").length };
}

function verdictOf(verdict: Verdict, asked: DecisionId | null): Round["verdict"] {
  switch (verdict.state) {
    case "returned":
      return { outcome: outcomeOf(verdict), results: verdict.criteria.map(({ result }) => result), fixRound: fixRoundOf(verdict), step: stepAt(verdict.at), asked };
    case "could-not-run":
      return { outcome: outcomeOf(verdict), results: [], fixRound: null, step: stepAt(verdict.at), asked: null };
    case "queued":
    case "running":
    case "superseded":
    case "waived":
      return { outcome: outcomeOf(verdict), results: [], fixRound: null, step: null, asked: null };
    default:
      return verdict satisfies never;
  }
}

/** What the verdict says, and what failed it first when it failed (verdict.ts firstFailure). */
function outcomeOf(verdict: Verdict): NonNullable<Round["verdict"]>["outcome"] {
  const result = outcome(verdict);
  if (result !== "fail") return { kind: result };
  return { kind: "fail", by: firstFailure(verdict)?.kind ?? "criteria" };
}

/**
 * The fix round a returned verdict's findings went back to its agent as, and whether they reached
 * it; null when they went to nobody, or are still on their way (the round is in flight then).
 */
function fixRoundOf({ settlement }: Extract<Verdict, { state: "returned" }>): NonNullable<Round["verdict"]>["fixRound"] {
  switch (settlement.kind) {
    case "sent-back":
      return { round: settlement.round, delivery: "sent" };
    case "maybe-sent-back":
      return { round: settlement.round, delivery: "maybe" };
    case "sending-back":
    case "pending":
    case "waiting-for-ci":
    case "checked":
    case "superseded":
      return null;
    default:
      return settlement satisfies never;
  }
}

/** What became of a returned verdict, once announced at `at`. why only a returned one: a verdict that never came says so in its verifier's step, which is its last. */
const outcomeStep = (verdict: Verdict, at: number | null): Step | null => (verdict.state === "returned" && at !== null ? stepAt(at) : null);

/** A step at `at`, before any status is attached to it (feed.ts). */
const stepAt = (at: number): Step => ({ at, moved: null });

/**
 * Each finding its verifier triaged, with its triage, once the verdict returned (joined as the
 * store read it, rounds/delta.ts), an earlier blocking finding a missed review left unfixed
 * included; before, the review's findings with no triage yet.
 */
function findingsOf({ review, verdict }: Check): RoundBody["findings"] {
  // why the title taken out: the tab shows none (roundBodySchema), so it isn't sent.
  if (verdict.state === "returned") return verdict.triage.map(({ title, file, line, severity, claim, origin, ...triage }) => ({ file, line, severity, claim, origin, triage }));
  return review.state === "reported" ? review.findings.map(({ file, line, severity, claim, origin }) => ({ file, line, severity, claim, origin, triage: null })) : [];
}

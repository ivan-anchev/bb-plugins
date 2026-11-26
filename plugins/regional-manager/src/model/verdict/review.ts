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

/**
 * Where a finding comes from, in a later round (rounds/delta.ts): `new`, on code changed since the
 * last reviewed commit; `missed`, on code an earlier round reviewed unchanged, which never fails
 * the verdict, whatever it breaks; `unfixed`, an earlier round's blocking finding not fixed. Every
 * finding of a first round is new.
 */
const originSchema = z.enum(["new", "missed", "unfixed"]);
type Origin = z.infer<typeof originSchema>;

/** How long a finding's title runs at most: the feed shows it as one row. */
export const MAX_FINDING_TITLE = 80;

/**
 * One thing the reviewer found: its title, what goes wrong in a line; where in the diff (its
 * file, and its line, null when it names none); how much it matters; what it claims is wrong; and
 * where it comes from. why the default: a finding stored before origins existed was the whole
 * diff's, so new. why no caps: they are issue_review's, on what a reviewer passes; a stored
 * finding keeps parsing whatever caps came later.
 */
export const reviewFindingSchema = z.object({
  title: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().min(1).nullable(),
  severity: severitySchema,
  claim: z.string().min(1),
  origin: originSchema.default("new"),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/**
 * A finding as a check stores it. why a title derived when it has none: findings stored before
 * titles existed have only their claim, so each gets its claim's first sentence once, here, and
 * every reader gets the one shape.
 */
const storedFindingSchema = reviewFindingSchema
  .extend({ title: reviewFindingSchema.shape.title.optional() })
  .transform(({ title, ...finding }): ReviewFinding => ({ ...finding, title: title ?? titleOf(finding.claim) }));

/** A claim's first sentence, on its first line, cut to MAX_FINDING_TITLE with an ellipsis: the title of a finding stored without one. */
function titleOf(claim: string): string {
  const line = claim.trim().replace(/[\r\n\u2028\u2029][\s\S]*$/, "");
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? line : line.slice(0, end + 1);
  return sentence.length <= MAX_FINDING_TITLE ? sentence : `${sentence.slice(0, MAX_FINDING_TITLE - 1).trimEnd()}…`;
}

/**
 * How many findings a reviewer reports at most, its own, in one review. why only its own: the
 * earlier blocking findings it answers, and carries on when not fixed, are as many as the earlier
 * round had, so issue_review's earlier and issue_verdict's triage take the whole list, checked
 * against it by number, and never use up these.
 */
export const MAX_REPORTED = 50;

/**
 * A later round's reviewer's answer on one of the earlier round's blocking findings, in their
 * order: whether it is fixed, and what it saw. One answered not fixed is also stored as an
 * `unfixed` finding of the review, for the verifier to triage.
 */
const earlierAnswerSchema = z.object({ fixed: z.boolean(), note: z.string() });

const reviewerThreadIdSchema = z.string().min(1);

/**
 * Where a check's review stands. `none`: the check has no review stage, as a final check, one made
 * while verification was off or of a checkout bb's git plugin couldn't read, and one made before
 * reviews existed. `queued`: its reviewer starts once the agent's thread is idle. `running`: a
 * reviewer thread reviews; `scoped` once its first message gave it the review's scope, the whole diff
 * or, after a reviewed round, only the change since (rounds/delta.ts). why false by default: a
 * reviewer started before scopes existed was given the whole diff, whatever the round.
 * `reported`: it returned its findings ([] for none), on the model bb ran it on, and its answers on
 * the earlier round's blocking findings (`earlier`, [] on a first round, and on one stored before
 * answers existed). `missed`: no
 * review was had, and why; its thread, if it had one. Verification goes ahead either way. Each of
 * the two keeps `at`, when it came (the migration gave every one stored before a time).
 */
export const reviewSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({ state: z.literal("queued") }),
  z.object({ state: z.literal("running"), reviewerThreadId: reviewerThreadIdSchema, scoped: z.boolean().default(false) }),
  z.object({ state: z.literal("reported"), at: z.number(), reviewerThreadId: reviewerThreadIdSchema, findings: z.array(storedFindingSchema), earlier: z.array(earlierAnswerSchema).default([]), model: modelRefSchema }),
  z.object({ state: z.literal("missed"), at: z.number(), reviewerThreadId: reviewerThreadIdSchema.nullable(), reason: z.string() }),
]);
export type Review = z.infer<typeof reviewSchema>;

/**
 * What a must-fix that blocks the work is (d68): a bug a user or agent hits in normal use, as safety
 * when it loses data or does something irreversible, as a regression when it breaks existing
 * behaviour, else as a bug; a broken done-criterion; a broken requirement the issue's brief states
 * explicitly; or a broken recorded decision.
 */
const anchorSchema = z.enum(["bug", "safety", "regression", "criterion", "brief", "decision"]);
type Anchor = z.infer<typeof anchorSchema>;

/** The anchors that are bugs reached in normal use, each anchored with the steps that reach it. */
const BUG_ANCHORS: ReadonlySet<Anchor> = new Set(["bug", "safety", "regression"]);

/** What each anchor names, in the words every place gives it: "Anchored, as <words>". */
const ANCHOR_WORDS: Record<Anchor, string> = {
  bug: "a bug hit in normal use",
  safety: "a safety bug: one hit in normal use that loses data or does something irreversible",
  regression: "a regression: existing behaviour that breaks in normal use",
  criterion: "it breaks a done-criterion",
  brief: "it breaks a requirement the issue's brief states explicitly",
  decision: "it breaks a recorded decision",
};

/**
 * What blocks the work, in the one wording each place a reviewer or a verifier reads gives it.
 * why the brief narrowed to what it states: a reviewer reviews as CREW.md instructs, so without it
 * a CREW.md or REVIEW.md rule, or an intent read into the brief, would block as the brief.
 */
export const ANCHOR_RULE = `A must-fix blocks the work only when it meets one of four anchors: a bug a user or agent hits in normal use, with the steps that reach it; a broken done-criterion; a broken requirement the issue's brief states explicitly, not one inferred from its intent; or a broken recorded decision. A bug that loses data or does something irreversible is a safety bug, and existing behaviour that breaks in normal use a regression: both are bugs hit in normal use, with their steps. Never blocking, so should-fix at most: a REVIEW.md or schrute-code principle violation, a missing test, unclear text, and a bug that needs a contrived setup to reach, such as a read held mid-await, a plugin disposed mid-call, calls interleaved by hand, a ref with shell or Markdown metacharacters, a reply lost in transit, or a state reachable only across an upgrade. A CREW.md or REVIEW.md rule blocks only when the brief states it or a done-criterion names it. Work that follows a recorded decision is never a finding.`;

/** What a missed finding does, in the one wording each place a reviewer or a verifier reads gives it. */
export const MISSED_RULE =
  "A finding marked missed sits on code an earlier round reviewed unchanged: it never fails the verdict, whatever it breaks, safety included, so it is never anchored. A missed must-fix that holds is downgraded, its origin the reason even when it meets an anchor; a missed should-fix or nit that holds is triaged as any other.";

/**
 * How a verifier rechecks a blocking defect an earlier verifier found, in the one wording each
 * place a verifier reads gives it: by its anchor, as only a bug anchor carries steps
 * (anchorProblem). why a requirement can lapse: the brief and the decisions may change after the
 * verifier that found it, as when the user approves what it called a broken decision.
 */
export const RECHECK_RULE =
  "Recheck each by its anchor: for a bug, safety or regression anchor, rerun its steps here, fixed only when they no longer reach it; for a criterion, brief or decision anchor, which has no steps, recheck the requirement it names, fixed when the work now meets it or the current brief and decisions no longer require it.";

/** What a blocking anchor carries besides its name: for a bug, the normal-use steps that reach it; null for any other anchor (anchorProblem). */
const stepsSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .nullable()
  .default(null)
  .describe('For a bug, safety or regression anchor: the normal-use steps that reach it, numbered on one line, as "1. … 2. …". null for any other anchor.');

/**
 * A defect the verifier found itself outside the done-criteria, as when creed-qa's checks of the
 * surrounding code turn one up, that meets a blocking anchor: its claim, the anchor and, for a bug,
 * the normal-use steps that reach it. Each one fails the verdict (verdict.ts failureReasons). A
 * defect that meets no anchor is no such thing: it goes in the verdict's findings, which never fail it.
 */
export const blockingDefectSchema = z.object({
  claim: z.string().trim().min(1).max(2_000).describe("What is wrong, where, and what you ran that shows it, in a few lines."),
  anchor: anchorSchema,
  steps: stepsSchema,
});
export type BlockingDefect = z.infer<typeof blockingDefectSchema>;

/**
 * Why an anchor can't be taken with its steps, in a phrase; null when it can: a bug, safety or
 * regression anchor needs the normal-use steps that reach it, and any other anchor takes none.
 * `otherwise`: what to do with a bug that has no such steps, as the refusal's way forward. The one
 * rule issue_verdict checks every anchor with, a triage's and a blocking defect's.
 */
export function anchorProblem({ anchor, steps }: { anchor: Anchor; steps: string | null }, otherwise: string): string | null {
  if (BUG_ANCHORS.has(anchor)) return steps === null ? `a ${anchor} anchor needs steps, the normal-use steps that reach it; a bug that needs a contrived setup to reach meets no anchor: ${otherwise}` : null;
  return steps === null ? null : `a ${anchor} anchor takes no steps, as it is no bug: pass steps as null`;
}

/** What an anchor names, with a bug's steps on the same line, as every place gives it after "Anchored" or "Blocks": "as a bug hit in normal use, reached by: 1. … 2. …". */
const anchorText = ({ anchor, steps }: { anchor: Anchor; steps: string | null }): string =>
  `as ${ANCHOR_WORDS[anchor]}${steps === null ? "" : `, reached by: ${steps.replaceAll("\n", " ")}`}`;

/** A blocking defect in a line, as catch-up, the agent's fix round and the board give it: its anchor, then its claim, the claim's later lines indented by `indent`. */
export const defectText = (defect: BlockingDefect, indent = ""): string => `Blocks, ${anchorText(defect)}: ${defect.claim.replaceAll("\n", `\n${indent}`)}`;

/**
 * Where the findings that hold go, in the one wording every place a reviewer, a verifier, an agent
 * or the regional manager reads gives it: what fails the verdict goes back; the rest waits for the
 * pass, which files it (rounds/follow-up.ts).
 */
export const FOLLOW_UP_RULE =
  "Only an anchored must-fix goes back to the agent, in its automatic fix round. The other findings that hold don't: when the issue passes, the plugin files them all as one follow-up issue in Backlog, blocked until the issue is Done, unless every one is a nit, which stays in the issue's feed.";

/**
 * The verifier's triage of one finding, as issue_verdict takes it and the check stores it, in the
 * review's order, each with why in a line: rejected, it doesn't hold or isn't worth fixing;
 * confirmed, a should-fix or nit that holds; anchored, a must-fix that holds and meets `anchor`,
 * with `steps`, the normal-use steps that reach it when the anchor is a bug (null otherwise);
 * downgraded, one that holds at the lower severity `to`. why `common`: issue_verdict takes the
 * same variants with the finding's number beside them (verdict-tool.ts). why steps default to
 * null: rows stored before d68 anchored safety and regression with none. Stored rows from before
 * the anchor rule are confirmed or rejected, and parse as they are.
 */
export const triageVariants = <Common extends z.ZodRawShape>(common: Common) =>
  z.discriminatedUnion("result", [
    z.object({ result: z.literal("rejected"), ...common }),
    z.object({ result: z.literal("confirmed"), ...common }),
    z.object({ result: z.literal("anchored"), anchor: anchorSchema, steps: stepsSchema, ...common }),
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
export const TRIAGE_RULE = `Rejected: it doesn't hold, or isn't worth fixing. Confirmed: a should-fix or nit that holds. Anchored: a must-fix that holds and meets an anchor; name it as its anchor: bug, safety or regression for a bug hit in normal use, with steps, the normal-use steps that reach it; criterion, brief or decision for a broken done-criterion, explicit brief requirement or recorded decision. Downgraded: it holds at a lower severity than the reviewer's, named as to: a must-fix that meets no anchor is downgraded, never confirmed, to should-fix, or to nit only when it is a matter of taste. Give each its reason in a line. Only an anchored must-fix fails the verdict, as a failed criterion does, even when every criterion passes, and goes back to the agent: anchor one only when what you ran or read shows it holds and meets that anchor. The others that hold are filed as a follow-up when the issue passes, unless all are nits. ${MISSED_RULE}`;

/**
 * Why a verifier's triage of a finding can't be taken, in a phrase; null when it can: a must-fix
 * that holds is anchored or downgraded, never just confirmed; only a must-fix is anchored, never a
 * missed one, safety included, and with the steps its anchor takes (anchorProblem); and a
 * downgrade goes lower than the reviewer's severity.
 * The one rule issue_verdict checks each entry with.
 */
export function triageProblem(finding: ReviewFinding, triage: Triage): string | null {
  const problem = severityProblem(finding, triage);
  if (problem !== null || triage.result !== "anchored") return problem;
  return anchorProblem(triage, "downgrade it to should-fix");
}

/** Why a triage can't be taken for its finding's severity and origin, in a phrase; null when it can (triageProblem, less the anchor's steps). */
function severityProblem({ severity, origin }: ReviewFinding, triage: Triage): string | null {
  switch (triage.result) {
    case "rejected":
      return null;
    case "confirmed":
      return severity === "must-fix" ? `a must-fix that holds is ${origin === "missed" ? "downgraded" : "anchored, naming the anchor it meets, or downgraded"}, never just confirmed` : null;
    case "anchored":
      if (severity !== "must-fix") return `only a must-fix is anchored, and this one is a ${severity}: ${holdsAs(severity, origin)}`;
      return origin === "missed" ? `a missed finding is never anchored, safety included, as it sits on code an earlier round reviewed unchanged: ${holdsAs(severity, origin)}` : null;
    case "downgraded":
      return lowerThan(severity).includes(triage.to) ? null : `a downgrade goes lower than the reviewer's ${severity}, and ${triage.to} isn't: ${holdsAs(severity, origin)}`;
    default:
      return triage satisfies never;
  }
}

/** Whether a finding held, as the verifier triaged it: every one it didn't reject. The one rule for what a round counts as held. */
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

/** The verifier's word on a finding, in the one wording catch-up, a handed-over agent and the board give it, on one line to sit in a list: "Anchored, as it breaks a recorded decision", "Anchored, as a bug hit in normal use, reached by: <steps>", "Downgraded to should-fix". */
export function triageText(triage: Triage): string {
  switch (triage.result) {
    case "rejected":
      return "Rejected";
    case "confirmed":
      return "Confirmed";
    case "anchored":
      return `Anchored, ${anchorText(triage)}`;
    case "downgraded":
      return `Downgraded to ${triage.to}`;
    default:
      return triage satisfies never;
  }
}

/** The severities lower than `severity`, the most a finding can matter first. */
const lowerThan = (severity: Severity): Severity[] => severitySchema.options.slice(severitySchema.options.indexOf(severity) + 1);

/**
 * How a finding of `severity` and `origin` that holds can be triaged, as a refusal's way forward:
 * a must-fix anchored, or downgraded, the only way for a missed one; any other confirmed, or
 * downgraded when a lower severity exists.
 */
function holdsAs(severity: Severity, origin: Origin): string {
  const lower = `downgrade it to ${lowerThan(severity).join(" or ")}`;
  if (severity === "must-fix") return origin === "missed" ? lower : `anchor it, naming the anchor it meets, or ${lower}`;
  return lowerThan(severity).length === 0 ? "confirm it" : `confirm it, or ${lower}`;
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
 * Each finding the verifier triaged (`findings`, the check's list, rounds/delta.ts triageList),
 * with its triage of it (`triage`, in the findings' order). why throw on a count that differs,
 * or on a triage the rule refuses for its finding's severity (triageProblem), as an anchored nit:
 * issue_verdict refuses both, and the two are stored together, so a stored check that breaks
 * either is refused as the store reads it, never read as failing a verdict it couldn't fail. A
 * confirmed must-fix passes: verdicts from before the anchor rule stored it so (verdict.ts
 * failsVerdict). A safety or regression anchor with no steps, as verdicts from before d68 stored
 * one, is checked by every rule but its steps.
 */
export function triaged(findings: readonly ReviewFinding[], triage: readonly Triage[]): Triaged[] {
  if (findings.length !== triage.length) throw new Error(`The verdict triages ${triage.length} of the check's ${findings.length} findings.`);
  return findings.map((finding, i) => {
    const one = at(triage, i);
    const problem = isLegacyConfirmed(finding, one) ? null : isStepless(one) ? severityProblem(finding, one) : triageProblem(finding, one);
    if (problem !== null) throw new Error(`The verdict's triage of finding ${i + 1} breaks the triage rule: ${problem}.`);
    return { ...finding, ...one };
  });
}

/** A must-fix the verifier confirmed, as verdicts from before the anchor rule stored one. */
const isLegacyConfirmed = ({ severity }: ReviewFinding, { result }: Triage): boolean => severity === "must-fix" && result === "confirmed";

/** A safety or regression anchor with no steps, as verdicts from before d68 stored one. */
const isStepless = (triage: Triage): boolean => triage.result === "anchored" && triage.steps === null && (triage.anchor === "safety" || triage.anchor === "regression");

/**
 * A finding as every message gives it: its title on a line of its own, so it reads in one line;
 * then its place, its severity and, when it isn't new, its origin, and its claim, each later line
 * indented by `indent` to sit under the title in a list. why the claim's lines alone re-indented:
 * the place keeps its path byte for byte, a newline in it included.
 */
export const findingText = (finding: ReviewFinding, indent = ""): string =>
  `${finding.title}\n${indent}${placeText(finding)} (${finding.severity}${finding.origin === "new" ? "" : `, ${finding.origin}`}): ${finding.claim.replaceAll("\n", `\n${indent}`)}`;

/** Findings as a numbered list, from 1, as issue_review's earlier and issue_verdict's triage take them (findingText). */
export const numberedText = (findings: readonly ReviewFinding[]): string => findings.map((finding, i) => `${i + 1}. ${findingText(finding, "   ")}`).join("\n");

/** Where in the diff a finding is, as code: its file, and its line when it names one. */
export const placeText = ({ file, line }: Pick<ReviewFinding, "file" | "line">): string => `\`${file}${line === null ? "" : `:${line}`}\``;

/** why throw: triaged checks the counts first. */
function at(triage: readonly Triage[], i: number): Triage {
  const one = triage[i];
  if (one === undefined) throw new Error(`No triage for finding ${i + 1}.`);
  return one;
}

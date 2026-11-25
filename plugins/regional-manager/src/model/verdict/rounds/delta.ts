// What a later round's review covers: the change since the last reviewed commit. The delta is never
// stored: it is derived from the issue's earlier checks each time, and a returned verdict's review
// and triage never change, so the reviewer's and the verifier's first messages, their tools and the
// store derive the same one. What is stored is the reviewer's words (review.ts): each finding's
// origin, and its answers on the earlier round's blocking findings.
import type { Check, HandoffCheck, StoredCheck } from "../check.ts";
import { holds, type Review, type ReviewFinding, type Triaged } from "../review.ts";
import { heldFindings, withReview, type Verdict } from "../verdict.ts";

/** A round whose review reported and whose verdict returned: the only kind a later round's review is based on. */
type ReviewedCheck = HandoffCheck & { review: Extract<Review, { state: "reported" }>; verdict: Extract<Verdict, { state: "returned" }> };

/**
 * What a check's review covers. `first`: no earlier round of the issue was both reviewed and
 * judged, so the whole diff. `after`: the change since `base`, the latest earlier round whose
 * review reported and whose verdict returned; `blocking`, the findings that failed its verdict, each
 * for the reviewer to answer fixed or not; `known`, every other finding earlier rounds held, once
 * each, for the reviewer not to report again.
 */
export type Delta = { kind: "first" } | { kind: "after"; base: ReviewedCheck; blocking: Triaged[]; known: Triaged[] };

/**
 * The delta of a check from the issue's checks before it (`earlier`, oldest first, whichever agent
 * handed off). why a round whose review was missed is skipped: nobody reviewed its change, so the
 * next review covers it too.
 */
export function deltaOf(earlier: readonly Check[]): Delta {
  const reviewed = earlier.filter(isReviewed);
  const base = reviewed.at(-1);
  if (base === undefined) return { kind: "first" };
  const blocking = heldFindings(base.verdict).failing;
  return { kind: "after", base, blocking, known: knownOf(reviewed, blocking) };
}

/**
 * The findings a check's verifier triages, in the order issue_verdict numbers them, for either
 * review state: a reported review's own, the earlier blocking findings it answered not fixed among
 * them; when the review was missed after a reviewed round, that round's blocking findings, each
 * unfixed, as a "not fixed" answer makes them, so a stalled reviewer drops no blocker. The one list
 * the verifier's first message, issue_verdict and the store read.
 */
export function triageList(review: Review, delta: Delta): ReviewFinding[] {
  switch (review.state) {
    case "reported":
      return review.findings;
    case "missed":
      return delta.kind === "after" ? delta.blocking.map(unfixed) : [];
    case "none":
    case "queued":
    case "running":
      return [];
    default:
      return review satisfies never;
  }
}

/** An earlier finding as an unfixed finding of a later round: its place, severity and claim as its reviewer gave them. */
export const unfixed = ({ file, line, severity, claim }: ReviewFinding): ReviewFinding => ({ file, line, severity, claim, origin: "unfixed" });

/**
 * An issue's checks as stored (`stored`, oldest first), each read whole: its verdict joined with the
 * list its verifier triaged (triageList), on the delta of the checks before it. why a missed
 * review's verdict that triaged nothing reads with no list: one returned before the delta existed
 * was given no earlier findings, and issue_verdict refuses a new one that skips any.
 */
export function readInOrder(stored: readonly StoredCheck[]): Check[] {
  const read: Check[] = [];
  for (const check of stored) {
    const { review, verdict } = check;
    const list = review.state === "missed" && verdict.state === "returned" && verdict.triage.length === 0 ? [] : triageList(review, deltaOf(read));
    read.push({ ...check, verdict: withReview(verdict, list) });
  }
  return read;
}

const isReviewed = (check: Check): check is ReviewedCheck => check.subject.kind === "handoff" && check.review.state === "reported" && check.verdict.state === "returned";

/** Every finding the reviewed rounds' verifiers held, but the blocking ones, each once, oldest first. */
function knownOf(reviewed: readonly ReviewedCheck[], blocking: readonly Triaged[]): Triaged[] {
  const known: Triaged[] = [];
  for (const finding of reviewed.flatMap(({ verdict }) => verdict.triage.filter(holds))) {
    if (![...blocking, ...known].some((seen) => sameFinding(seen, finding))) known.push(finding);
  }
  return known;
}

/** Whether two findings are one: the same place and claim, byte for byte. */
const sameFinding = (a: ReviewFinding, b: ReviewFinding): boolean => a.file === b.file && a.line === b.line && a.claim === b.claim;

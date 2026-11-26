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
  const blocking = blockingOf(base);
  return { kind: "after", base, blocking, known: knownOf(reviewed, blocking) };
}

/** What triageList reads of a delta: whether a round before was reviewed, and that round's blocking findings. */
type Blocking = { kind: "first" } | { kind: "after"; blocking: readonly ReviewFinding[] };

/**
 * The findings a check's verifier triages, in the order issue_verdict numbers them, for either
 * review state: a reported review's own, the earlier blocking findings it answered not fixed among
 * them; when the review was missed after a reviewed round, that round's blocking findings, each
 * unfixed, as a "not fixed" answer makes them, so a stalled reviewer drops no blocker. The one list
 * the verifier's first message, issue_verdict and the store read.
 */
export function triageList(review: Review, delta: Blocking): ReviewFinding[] {
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
 * An issue's checks as stored (`stored`, oldest first), each read whole, in one pass: its verdict
 * joined with the list its verifier triaged (triageList), on the blocking findings of the latest
 * reviewed round before it, the base deltaOf names. why a missed review's verdict that triaged
 * nothing reads with no list: one returned before the delta existed was given no earlier findings,
 * and issue_verdict refuses a new one that skips any.
 */
export function readInOrder(stored: readonly StoredCheck[]): Check[] {
  const read: Check[] = [];
  let base: ReviewedCheck | null = null;
  for (const check of stored) {
    const { review, verdict } = check;
    const legacy = review.state === "missed" && verdict.state === "returned" && verdict.triage.length === 0;
    const list = legacy ? [] : triageList(review, base === null ? { kind: "first" } : { kind: "after", blocking: blockingOf(base) });
    const joined: Check = { ...check, verdict: withReview(verdict, list) };
    read.push(joined);
    if (isReviewed(joined)) base = joined;
  }
  return read;
}

const isReviewed = (check: Check): check is ReviewedCheck => check.subject.kind === "handoff" && check.review.state === "reported" && check.verdict.state === "returned";

/** The findings that failed a reviewed round's verdict. */
const blockingOf = (base: ReviewedCheck): Triaged[] => heldFindings(base.verdict).failing;

/** Every finding the reviewed rounds' verifiers held, but the blocking ones, each once, oldest first. */
function knownOf(reviewed: readonly ReviewedCheck[], blocking: readonly Triaged[]): Triaged[] {
  const seen = new Set(blocking.map(findingKey));
  return reviewed.flatMap(({ verdict }) =>
    verdict.triage.filter((finding) => {
      const key = findingKey(finding);
      if (!holds(finding) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

/** What makes two findings one, for the known findings and a follow-up's list alike: the same place and claim, byte for byte. why JSON: it keeps every part apart, whatever bytes a path or claim holds. */
export const findingKey = ({ file, line, claim }: ReviewFinding): string => JSON.stringify([file, line, claim]);

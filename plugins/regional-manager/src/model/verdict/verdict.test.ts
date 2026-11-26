import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffIdSchema } from "../agent/handoff.ts";
import { ciOf, type PrSnapshot } from "./pr.ts";
import type { Review, ReviewFinding } from "./review.ts";
import { failedOnReviewOnly, failureReasons, judge, outcome, shownVerdict, storedVerdictSchema, withReview, type CriterionResult, type StoredVerdict, type Verdict } from "./verdict.ts";

/** The claimed commit, on a clean tree, as bb's git plugin read it. */
const CLEAN = { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 };

/** A returned verdict as the plugin holds it, with no review findings. */
const returned = (results: CriterionResult[], settlement: Settlement = { kind: "checked", refused: null, ci: { kind: "none" } }): Extract<Verdict, { state: "returned" }> => ({
  state: "returned",
  at: 5_000,
  verifierThreadId: "thr_v",
  headSha: "a".repeat(40),
  checkout: CLEAN,
  criteria: results.map((result, i) => ({ criterion: `criterion ${i + 1}`, result, evidence: "ran it" })),
  findings: [],
  blocking: [],
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  triage: [],
  mustFixFails: true,
  settlement,
});

type Settlement = Extract<Verdict, { state: "returned" }>["settlement"];

test("a verdict's outcome is derived from its state, and a returned one from every criterion", () => {
  const cases: [Verdict, ReturnType<typeof outcome>][] = [
    [{ state: "queued", checkout: CLEAN }, "pending"],
    [{ state: "running", verifierThreadId: "thr_v", nudged: true, declined: [], checkout: CLEAN }, "pending"],
    [returned(["pass"]), "pass"],
    [returned(["pass", "pass", "pass"]), "pass"],
    [returned(["pass", "fail"]), "fail"],
    [{ state: "could-not-run", at: 5_000, verifierThreadId: null, reason: "bb did not start a verifier" }, "could-not-run"],
    [{ state: "superseded" }, "superseded"],
    [{ state: "waived" }, "unverified"],
  ];
  for (const [verdict, expected] of cases) assert.equal(outcome(verdict), expected, JSON.stringify(verdict));
});

test("a criterion the verifier couldn't check is not a pass", () => {
  assert.equal(outcome(returned(["pass", "unverifiable"])), "fail");
  assert.equal(outcome(returned(["unverifiable"])), "fail");
});

/** A finding of the given severity, as the reviewer reported it. */
const finding = (severity: Severity): ReviewFinding => ({ file: "src/retry.ts", line: 4, severity, claim: "The backoff never caps.", origin: "new" });
type Severity = ReviewFinding["severity"];

/** A verdict that passed both its criteria, as the store reads it with the findings its verifier triaged: each finding of `severity` triaged as `triage`. */
function readWith(triaged: [Severity, Triage][], mustFixFails = true): Extract<Verdict, { state: "returned" }> {
  const { triage: _none, ...stored } = returned(["pass", "pass"]);
  const verdict = withReview({ ...stored, mustFixFails, triage: triaged.map(([, triage]) => triage) }, triaged.map(([severity]) => finding(severity)));
  return verdict.state === "returned" ? verdict : assert.fail("not returned");
}
type Triage = Extract<StoredVerdict, { state: "returned" }>["triage"][number];

const ANCHORED: Triage = { result: "anchored", anchor: "brief", steps: null, reason: "The brief says retries back off." };
const DOWNGRADED: Triage = { result: "downgraded", to: "should-fix", reason: "It breaks none of the five." };
const CONFIRMED: Triage = { result: "confirmed", reason: "Seen." };
const REJECTED: Triage = { result: "rejected", reason: "It caps at 5 minutes." };

test("a verdict whose criteria all pass fails only when the verifier anchored a finding; a downgraded must-fix, a rejected one, and confirmed should-fix and nit ones pass", () => {
  assert.equal(outcome(readWith([["must-fix", ANCHORED]])), "fail");
  assert.equal(outcome(readWith([["nit", REJECTED], ["must-fix", ANCHORED]])), "fail");
  assert.equal(outcome(readWith([["must-fix", DOWNGRADED]])), "pass", "a downgraded must-fix passes");
  assert.equal(outcome(readWith([["must-fix", REJECTED], ["should-fix", CONFIRMED], ["nit", CONFIRMED], ["must-fix", { ...DOWNGRADED, to: "nit" }]])), "pass");
  assert.deepEqual(failureReasons(readWith([["must-fix", ANCHORED], ["must-fix", DOWNGRADED], ["nit", CONFIRMED], ["must-fix", REJECTED]])), [{ kind: "must-fix", count: 1 }], "only the anchored finding counts");
  assert.equal(judge(readWith([["must-fix", ANCHORED]]), { kind: "waiting", number: 41 }), "fail", "it fails before CI is judged, as a failed criterion does");
});

test("a stored verdict from before the anchor rule, with a confirmed must-fix, keeps the outcome mustFixFails gave it", () => {
  // As the store holds it: the verifier's word on each finding was confirmed or rejected, with no anchor.
  const { triage: _none, ...rest } = returned(["pass", "pass"]);
  const stored = storedVerdictSchema.parse({ ...rest, triage: [{ result: "confirmed", reason: "Seen." }] });
  assert.deepEqual(stored.state === "returned" && stored.triage, [{ result: "confirmed", reason: "Seen." }], "it parses as it is");
  assert.equal(outcome(withReview(stored, [finding("must-fix")])), "fail", "returned under the must-fix rule: it failed, and still does");
  assert.deepEqual(failureReasons(readWith([["must-fix", CONFIRMED]])), [{ kind: "must-fix", count: 1 }]);
  assert.equal(outcome(readWith([["must-fix", CONFIRMED]], false)), "pass", "settled before the must-fix rule: it passed, and still does");
});

test("a stored triage the rule refuses for its finding's severity is refused as the store reads it, never read as failing a verdict", () => {
  assert.throws(() => readWith([["nit", ANCHORED]]), /^Error: The verdict's triage of finding 1 breaks the triage rule: only a must-fix is anchored, and this one is a nit: confirm it\.$/);
  assert.throws(() => readWith([["must-fix", REJECTED], ["should-fix", ANCHORED]]), /triage of finding 2 breaks the triage rule: only a must-fix is anchored, and this one is a should-fix/);
  assert.throws(() => readWith([["should-fix", DOWNGRADED]]), /triage of finding 1 breaks the triage rule: a downgrade goes lower than the reviewer's should-fix, and should-fix isn't/);
  assert.equal(outcome(readWith([["must-fix", CONFIRMED], ["should-fix", { ...DOWNGRADED, to: "nit" }]])), "fail", "a confirmed must-fix from before the anchor rule still reads, and a valid downgrade beside it");
});

test("a stored safety or regression anchor with no steps, as before d68, reads and fails its verdict; on a nit or a missed finding it is refused as the store reads it, as any anchor there is", () => {
  const stepless = (anchor: "safety" | "regression"): Triage => ({ result: "anchored", anchor, steps: null, reason: "It loses deliveries." });
  assert.equal(outcome(readWith([["must-fix", stepless("safety")], ["must-fix", stepless("regression")]])), "fail");
  assert.throws(() => readWith([["nit", stepless("safety")]]), /^Error: The verdict's triage of finding 1 breaks the triage rule: only a must-fix is anchored, and this one is a nit: confirm it\.$/);
  const { triage: _none, ...stored } = returned(["pass", "pass"]);
  assert.throws(
    () => withReview({ ...stored, triage: [stepless("regression")] }, [{ ...finding("must-fix"), origin: "missed" }]),
    /triage of finding 1 breaks the triage rule: a missed finding is never anchored, safety included/,
  );
  assert.throws(() => readWith([["must-fix", { result: "anchored", anchor: "bug", steps: null, reason: "It crashes." }]]), /a bug anchor needs steps/, "only safety and regression were stored with no steps");
});

test("a blocking defect the verifier found itself fails a verdict whose criteria all pass, after any failing review finding; findings never do", () => {
  const defect = { claim: "`node cli.js` crashes on an empty counts.json.", anchor: "bug", steps: "1. Create an empty counts.json. 2. Run node cli.js signup." } as const;
  assert.deepEqual(failureReasons({ ...returned(["pass", "pass"]), blocking: [defect, { ...defect, claim: "Another." }] }), [{ kind: "defect", count: 2 }]);
  assert.deepEqual(failureReasons({ ...readWith([["must-fix", ANCHORED]]), blocking: [defect] }), [{ kind: "must-fix", count: 1 }, { kind: "defect", count: 1 }]);
  assert.equal(outcome({ ...returned(["pass", "pass"]), findings: ["A read held mid-await loses an update (should-fix)."] }), "pass");
  assert.deepEqual(shownVerdict({ ...returned(["pass"]), blocking: [defect] }), { ...shownVerdict(returned(["pass"])), blocking: [defect] }, "the board gets the defects it lists");
});

test("a returned verdict is pending until it is settled: its findings reached the agent, or it is checked", () => {
  const cases: [Settlement, ReturnType<typeof outcome>][] = [
    [{ kind: "pending" }, "pending"],
    [{ kind: "sending-back", round: 1, ci: { kind: "none" } }, "pending"],
    [{ kind: "sent-back", round: 1, ci: { kind: "none" } }, "fail"],
    [{ kind: "checked", refused: null, ci: { kind: "none" } }, "fail"],
    [{ kind: "waiting-for-ci" }, "waiting-for-ci"],
  ];
  for (const [settlement, expected] of cases) assert.equal(outcome(returned(["fail"], settlement)), expected, settlement.kind);
});

test("a verdict stored before settlements existed reads as settled", () => {
  // As migrations.ts left it: no settlement and no triage, and mustFixFails false, as it settled before that rule.
  const stored = storedVerdictSchema.parse({ state: "returned", at: 5_000, verifierThreadId: "thr_v", headSha: "a".repeat(40), checkout: CLEAN, criteria: [{ criterion: "npm test passes", result: "pass", evidence: "ran it" }], blocking: [], findings: [], mustFixFails: false, model: { providerId: "codex", model: "gpt-default" }, sameModel: false });
  assert.equal(outcome(withReview(stored, [])), "pass");
});

const HEAD = "a".repeat(40);
const PR_URL = "https://github.com/octo-org/widgets/pull/12";
const passed = () => returned(["pass", "pass"], { kind: "pending" });
const snapshot = (fields: Partial<PrSnapshot>): PrSnapshot => ({ number: 12, url: PR_URL, state: "open", draft: false, review: "none", ci: "pending", headSha: HEAD, failedChecks: [], ...fields });
const HANDOFF = handoffIdSchema.parse("6f1c2a54-0b8e-4c3e-9d7a-2f5e8b1c4d90");
/** The done handoff CI is judged for: its commit is HEAD, and it names this pull request (null: none). */
const claim = (prUrl: string | null) => ({ id: HANDOFF, headSha: HEAD, prUrl });
/** A PR status whose latest read that found the pull request came since the handoff, a minute after a read first saw its head. */
const seen = (fields: Partial<PrSnapshot>) => ({ snapshot: snapshot(fields), headSeenAt: 0, readAt: 60_000, handoffAtRead: HANDOFF, unavailable: null });

test("a handoff that names a pull request with no snapshot yet is waiting-for-ci, not a pass", () => {
  assert.equal(judge(passed(), ciOf(claim(PR_URL), null)), "waiting-for-ci");
  assert.equal(judge(passed(), ciOf(claim(PR_URL), { snapshot: null, unavailable: null })), "waiting-for-ci");
});

test("a snapshot for a different head SHA does not settle the verdict, whatever its CI says", () => {
  for (const ci of ["pass", "fail", "none"] as const) {
    assert.equal(judge(passed(), ciOf(claim(PR_URL), seen({ ci, headSha: "b".repeat(40) }))), "waiting-for-ci", ci);
  }
});

test("judge: CI on the handoff's commit decides a verdict that passed every criterion; failed criteria fail whatever CI says", () => {
  const ci = (fields: Partial<PrSnapshot>) => ciOf(claim(PR_URL), seen(fields));
  assert.equal(judge(passed(), ci({ ci: "pending" })), "waiting-for-ci");
  assert.equal(judge(passed(), ci({ ci: "pass" })), "pass");
  assert.equal(judge(passed(), ci({ ci: "fail" })), "fail");
  assert.equal(judge(passed(), ci({ ci: "none" })), "waiting-for-ci", "zero checks a minute after the commit was seen: GitHub may still attach them");
  assert.equal(judge(passed(), ciOf(claim(PR_URL), { ...seen({ ci: "none" }), readAt: 5 * 60_000 })), "pass", "still none past the window: a pass, labelled no CI checks elsewhere");
  assert.equal(judge(passed(), ciOf(claim(null), null)), "pass", "no pull request named or known");
  assert.equal(judge(passed(), ciOf(claim(PR_URL), { snapshot: null, unavailable: { kind: "persistent", reason: "gh isn't signed in" } })), "pass", "a pass whose CI can't be checked, labelled so elsewhere");
  assert.equal(judge(passed(), ciOf(claim(PR_URL), { snapshot: null, unavailable: { kind: "transient", reason: "couldn't reach GitHub" } })), "waiting-for-ci", "a read that failed for now says nothing about CI");
  const failed = returned(["pass", "fail"], { kind: "pending" });
  assert.equal(judge(failed, ci({ ci: "pending" })), "fail");
  assert.equal(judge(failed, ci({ ci: "pass" })), "fail");
});

test("a settled verdict keeps the CI it settled with: a pass that CI failed reads fail", () => {
  assert.equal(outcome(returned(["pass"], { kind: "checked", refused: null, ci: { kind: "fail", number: 12, failedChecks: ["test"] } })), "fail");
  assert.equal(outcome(returned(["pass"], { kind: "checked", refused: null, ci: { kind: "not-checked", reason: "PR status unavailable: gh isn't signed in" } })), "pass");
});

test("a verdict failed on review findings alone only when every reason it failed is an anchored must-fix: never with a failed criterion, a dirty tree, a blocking defect or failed CI, nor when it passed or is still to settle", () => {
  const reviewOnly = readWith([["must-fix", ANCHORED]]);
  assert.equal(failedOnReviewOnly(reviewOnly), true);
  assert.equal(failedOnReviewOnly({ ...reviewOnly, criteria: [...reviewOnly.criteria, { criterion: "lint", result: "fail", evidence: "1 problem" }] }), false, "a criterion failed too");
  assert.equal(failedOnReviewOnly({ ...reviewOnly, checkout: { ...CLEAN, changedFiles: ["x.ts"], changedFileCount: 1 } }), false, "not on a clean tree");
  assert.equal(failedOnReviewOnly({ ...reviewOnly, blocking: [{ claim: "Retries leak a socket.", anchor: "brief", steps: null }] }), false, "a blocking defect of the verifier's");
  assert.equal(failedOnReviewOnly({ ...reviewOnly, settlement: { kind: "checked", refused: null, ci: { kind: "fail", number: 41, failedChecks: ["test"] } } }), false, "CI failed");
  assert.equal(failedOnReviewOnly({ ...reviewOnly, settlement: { kind: "pending" } }), false, "still to settle");
  assert.equal(failedOnReviewOnly(readWith([["must-fix", DOWNGRADED]])), false, "it passed");
  assert.equal(failedOnReviewOnly(returned(["fail"])), false, "a criterion alone");
});

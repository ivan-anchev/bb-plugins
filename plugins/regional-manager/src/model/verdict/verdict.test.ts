import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffIdSchema } from "../agent/handoff.ts";
import { ciOf, type PrSnapshot } from "./pr.ts";
import type { Review } from "./review.ts";
import { failureReasons, judge, outcome, shownVerdict, storedVerdictSchema, withReview, type CriterionResult, type Verdict } from "./verdict.ts";

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

test("a must-fix finding the verifier confirmed fails a verdict that passes every criterion; a rejected one, and confirmed should-fix and nit ones, never do", () => {
  type Triaged = [severity: "must-fix" | "should-fix" | "nit", result: "confirmed" | "rejected"];
  /** A verdict that passed both its criteria, as the store reads it with its review (each finding triaged as given). */
  const read = (triaged: Triaged[], mustFixFails = true) => {
    const { triage, ...stored } = returned(["pass", "pass"]);
    const findings = triaged.map(([severity]) => ({ file: "src/retry.ts", line: 4, severity, claim: "The backoff never caps." }));
    const review: Review = { state: "reported", at: 4_000, reviewerThreadId: "thr_r", findings, model: { providerId: "codex", model: "gpt-default" } };
    const verdict = withReview({ ...stored, mustFixFails, triage: triaged.map(([, result]) => ({ result, reason: "ran it" })) }, review);
    return verdict.state === "returned" ? verdict : assert.fail("not returned");
  };
  assert.equal(outcome(read([["must-fix", "confirmed"]])), "fail");
  assert.equal(outcome(read([["nit", "rejected"], ["must-fix", "confirmed"]])), "fail");
  assert.equal(outcome(read([["must-fix", "rejected"], ["should-fix", "confirmed"], ["nit", "confirmed"]])), "pass");
  assert.equal(outcome(read([["must-fix", "confirmed"]], false)), "pass", "a verdict settled before the rule keeps its outcome");
  assert.deepEqual(failureReasons(read([["must-fix", "confirmed"], ["nit", "confirmed"], ["must-fix", "rejected"]])), [{ kind: "must-fix", count: 1 }], "only the confirmed must-fix finding counts");
  assert.equal(judge(read([["must-fix", "confirmed"]]), { kind: "waiting", number: 41 }), "fail", "it fails before CI is judged, as a failed criterion does");
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
  const stored = storedVerdictSchema.parse({ state: "returned", at: 5_000, verifierThreadId: "thr_v", headSha: "a".repeat(40), checkout: CLEAN, criteria: [{ criterion: "npm test passes", result: "pass", evidence: "ran it" }], findings: [], mustFixFails: false, model: { providerId: "codex", model: "gpt-default" }, sameModel: false });
  assert.equal(outcome(withReview(stored, { state: "none" })), "pass");
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

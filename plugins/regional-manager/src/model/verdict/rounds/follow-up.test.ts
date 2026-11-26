import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../agent/agent.ts";
import { handoffIdSchema } from "../../agent/handoff.ts";
import { issueIdSchema } from "../../issue/issue.ts";
import type { Triaged } from "../review.ts";
import type { Verdict } from "../verdict.ts";
import { followUpPlan, leftoversOf, onlyNits, unfiledAtMerge } from "./follow-up.ts";
import type { Check } from "../check.ts";

const ORIGIN = issueIdSchema.parse("WEB-4");
const SHA = "a".repeat(40);

const PLACE = { file: "src/retry.ts", line: 42, origin: "new" } as const;

const nit: Triaged = { title: "Name the constant", ...PLACE, severity: "nit", claim: "Name the constant.", result: "confirmed", reason: "It reads better." };
const shouldFix: Triaged = { title: "Log the retry", ...PLACE, severity: "should-fix", claim: "Log the retry.", result: "confirmed", reason: "Nobody sees a retry." };
const downgraded: Triaged = { title: "The backoff never caps", ...PLACE, severity: "must-fix", claim: "The backoff never caps.", result: "downgraded", to: "should-fix", reason: "No criterion names a cap." };
const downgradedShouldFix: Triaged = { title: "Split the module", ...PLACE, severity: "should-fix", claim: "Split the module.", result: "downgraded", to: "nit", reason: "Taste." };

test("leftovers that are all nits plan no follow-up, a should-fix downgraded to a nit included", () => {
  assert.equal(followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [{ round: 1, leftovers: [nit, downgradedShouldFix], own: [] }], "passed"), null);
  assert.equal(followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [], "passed"), null);
});

test("a confirmed should-fix plans one top-level Backlog build issue depending on its origin, with no done-criteria, that lists the nits too", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [{ round: 2, leftovers: [nit, shouldFix], own: [] }], "passed");
  assert.ok(plan !== null);
  assert.deepEqual({ ...plan, brief: null, description: null }, {
    kind: "build",
    title: "Follow-ups from WEB-4: Add retries",
    description: null,
    brief: null,
    doneCriteria: [],
    verifier: null,
    rest: "backlog",
    parentId: null,
    dependsOn: [ORIGIN],
  });
  assert.match(plan.brief ?? "", /check that each still holds/);
  assert.equal(
    plan.description,
    "2 review findings held without blocking WEB-4 when it passed. Its brief lists each, with its round and the verifier's reason: check each still holds first. Plan this issue's done-criteria before an agent starts.",
  );
  assert.match(plan.brief ?? "", /- Round 2: Name the constant\n {2}`src\/retry.ts:42` \(nit\): Name the constant\.\n {2}The verifier: Confirmed\. It reads better\./);
  assert.match(plan.brief ?? "", /- Round 2: Log the retry\n {2}`src\/retry.ts:42` \(should-fix\): Log the retry\.\n {2}The verifier: Confirmed\. Nobody sees a retry\./);
});

test("a downgraded must-fix plans one, naming the severity it was downgraded to and the verifier's reason", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [{ round: 1, leftovers: [downgraded], own: [] }], "passed");
  assert.match(plan?.brief ?? "", /- Round 1: The backoff never caps\n {2}`src\/retry.ts:42` \(must-fix\): The backoff never caps\.\n {2}The verifier: Downgraded to should-fix\. No criterion names a cap\./);
});

test("a finding two rounds held is listed once, with the latest round that held it", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [
    { round: 1, leftovers: [shouldFix, nit], own: [] },
    { round: 3, leftovers: [{ ...shouldFix, reason: "Still no log." }], own: [] },
  ], "passed");
  const brief = plan?.brief ?? "";
  assert.equal(brief.split("Log the retry.").length - 1, 1);
  assert.match(brief, /- Round 3: Log the retry\n {2}`src\/retry.ts:42` \(should-fix\): Log the retry\.\n {2}The verifier: Confirmed\. Still no log\./);
  assert.match(brief, /- Round 1: Name the constant\n {2}`src\/retry.ts:42` \(nit\): Name the constant\./);
});

test("a follow-up of a follow-up is titled after the first origin, and depends on its own", () => {
  const second = issueIdSchema.parse("WEB-9");
  const plan = followUpPlan(second, { id: ORIGIN, title: "Add retries" }, [{ round: 1, leftovers: [shouldFix], own: [] }], "passed");
  assert.equal(plan?.title, "Follow-ups from WEB-4: Add retries");
  assert.deepEqual(plan?.dependsOn, [second]);
  assert.match(plan?.brief ?? "", /The reviews and verifiers of WEB-9 held/);
});

test("a should-fix an earlier round held still files when a later round holds the same finding only as a nit, listed once from the later round", () => {
  const asNit: Triaged = { ...shouldFix, result: "downgraded", to: "nit", reason: "A later look: only taste." };
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [
    { round: 1, leftovers: [shouldFix], own: [] },
    { round: 2, leftovers: [asNit], own: [] },
  ], "passed");
  assert.ok(plan !== null, "round 1's should-fix qualifies");
  assert.equal((plan.brief ?? "").split("Log the retry.").length - 1, 1);
  assert.match(plan.brief ?? "", /- Round 2: Log the retry\n {2}`src\/retry.ts:42` \(should-fix\): Log the retry\.\n {2}The verifier: Downgraded to nit\. A later look: only taste\./);
});

test("a title past the 80 characters an issue's title holds is cut with an ellipsis", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Retry failed webhook deliveries with exponential backoff and a cap on attempts" }, [{ round: 1, leftovers: [shouldFix], own: [] }], "passed");
  assert.equal(plan?.title, "Follow-ups from WEB-4: Retry failed webhook deliveries with exponential backoff…");
  assert.equal(plan?.title.length, 80);
});

test("a check's leftovers are what it held without failing it: an anchored must-fix and a rejected finding are not, and an unreturned verdict has none", () => {
  const anchored: Triaged = { title: "Retries drop the payload", ...PLACE, severity: "must-fix", claim: "Retries drop the payload.", result: "anchored", anchor: "criterion", steps: null, reason: "Criterion 2 fails." };
  const rejected: Triaged = { title: "Use a queue", ...PLACE, severity: "should-fix", claim: "Use a queue.", result: "rejected", reason: "Out of scope." };
  const verdict: Verdict = {
    state: "returned",
    at: 5_000,
    verifierThreadId: "thr_v",
    headSha: SHA,
    checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
    criteria: [{ criterion: "npm test passes", result: "pass", shows: "Ran it.", evidence: "ok" }],
    blocking: [],
    findings: [],
    triage: [anchored, shouldFix, rejected, downgraded, nit],
    mustFixFails: true,
    model: { providerId: "codex", model: "gpt-default" },
    sameModel: false,
    settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
  };
  assert.deepEqual(leftoversOf({ verdict, acceptedAt: null }), [shouldFix, downgraded, nit]);
  assert.deepEqual(leftoversOf({ verdict: { state: "queued", checkout: null }, acceptedAt: null }), []);
});

/** A returned verdict on one criterion, `result`, triaging `triage`, settled as checked. */
const verdictOf = (result: "pass" | "fail", triage: Triaged[]): Extract<Verdict, { state: "returned" }> => ({
  state: "returned",
  at: 5_000,
  verifierThreadId: "thr_v",
  headSha: SHA,
  checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
  criteria: [{ criterion: "npm test passes", result, shows: "Ran it.", evidence: "ok" }],
  blocking: [],
  findings: [],
  triage,
  mustFixFails: true,
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
});
const HANDOFF: Check["subject"] = { kind: "handoff", agentId: agentIdSchema.parse("a1"), handoffId: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), headSha: SHA, prUrl: null, branch: null };
const round = (verdict: Verdict, followUpId: Check["followUpId"] = null) => ({ subject: HANDOFF, verdict, followUpId, acceptedAt: null });
const anchored: Triaged = { title: "Retries drop the payload", ...PLACE, severity: "must-fix", claim: "Retries drop the payload.", result: "anchored", anchor: "criterion", steps: null, reason: "Criterion 2 fails." };

test("a merge leaves unfiled every uncollected round's leftovers, and the findings that failed the latest verdict when nothing fixed them", () => {
  assert.deepEqual(unfiledAtMerge([round(verdictOf("fail", [anchored]))]), [anchored], "a held blocker of the latest, failed verdict");
  assert.deepEqual(unfiledAtMerge([round(verdictOf("fail", [anchored, nit])), round(verdictOf("pass", [shouldFix]))]), [nit, shouldFix], "a later pass fixed the blocker; the leftovers of both rounds stay");
  assert.deepEqual(unfiledAtMerge([round(verdictOf("fail", [anchored, nit]), issueIdSchema.parse("WEB-9")), round(verdictOf("pass", []), issueIdSchema.parse("WEB-9"))]), [], "a follow-up collected them");
  const unsettled: Verdict = { ...verdictOf("pass", [anchored, nit]), settlement: { kind: "pending" } };
  assert.deepEqual(unfiledAtMerge([round(unsettled)]), [nit, anchored], "a verdict returned and still to settle counts as its settling will");
});

test("only nits is every leftover a nit as triaged: a should-fix downgraded to a nit counts as one, a downgraded must-fix never does", () => {
  assert.equal(onlyNits([nit, downgradedShouldFix]), true);
  assert.equal(onlyNits([nit, downgraded]), false);
  assert.equal(onlyNits([]), true);
});

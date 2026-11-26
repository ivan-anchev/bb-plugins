import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../issue/issue.ts";
import type { Triaged } from "../review.ts";
import type { Verdict } from "../verdict.ts";
import { followUpPlan, leftoversOf } from "./follow-up.ts";

const ORIGIN = issueIdSchema.parse("WEB-4");
const SHA = "a".repeat(40);

const PLACE = { file: "src/retry.ts", line: 42, origin: "new" } as const;

const nit: Triaged = { ...PLACE, severity: "nit", claim: "Name the constant.", result: "confirmed", reason: "It reads better." };
const shouldFix: Triaged = { ...PLACE, severity: "should-fix", claim: "Log the retry.", result: "confirmed", reason: "Nobody sees a retry." };
const downgraded: Triaged = { ...PLACE, severity: "must-fix", claim: "The backoff never caps.", result: "downgraded", to: "should-fix", reason: "No criterion names a cap." };
const downgradedShouldFix: Triaged = { ...PLACE, severity: "should-fix", claim: "Split the module.", result: "downgraded", to: "nit", reason: "Taste." };

test("leftovers that are all nits plan no follow-up, a should-fix downgraded to a nit included", () => {
  assert.equal(followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [{ round: 1, leftovers: [nit, downgradedShouldFix] }]), null);
  assert.equal(followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, []), null);
});

test("a confirmed should-fix plans one top-level Backlog build issue depending on its origin, with no done-criteria, that lists the nits too", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [{ round: 2, leftovers: [nit, shouldFix] }]);
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
    "2 review findings held without blocking WEB-4 when it passed. A later round may have fixed one: check each still holds first. Plan this issue's done-criteria before an agent starts.\n\n- src/retry.ts:42, round 2, nit: Name the constant. The verifier: It reads better.\n- src/retry.ts:42, round 2, should-fix: Log the retry. The verifier: Nobody sees a retry.",
    "the tab and the board show each finding with its round, its severity as triaged and the verifier's reason",
  );
  assert.match(plan.brief ?? "", /- Round 2: `src\/retry.ts:42` \(nit\): Name the constant\.\n {2}The verifier: Confirmed\. It reads better\./);
  assert.match(plan.brief ?? "", /- Round 2: `src\/retry.ts:42` \(should-fix\): Log the retry\.\n {2}The verifier: Confirmed\. Nobody sees a retry\./);
});

test("a downgraded must-fix plans one, naming the severity it was downgraded to and the verifier's reason", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [{ round: 1, leftovers: [downgraded] }]);
  assert.match(plan?.brief ?? "", /- Round 1: `src\/retry.ts:42` \(must-fix\): The backoff never caps\.\n {2}The verifier: Downgraded to should-fix\. No criterion names a cap\./);
});

test("a finding two rounds held is listed once, with the latest round that held it", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [
    { round: 1, leftovers: [shouldFix, nit] },
    { round: 3, leftovers: [{ ...shouldFix, reason: "Still no log." }] },
  ]);
  const brief = plan?.brief ?? "";
  assert.equal(brief.split("Log the retry.").length - 1, 1);
  assert.match(brief, /- Round 3: `src\/retry.ts:42` \(should-fix\): Log the retry\.\n {2}The verifier: Confirmed\. Still no log\./);
  assert.match(brief, /- Round 1: `src\/retry.ts:42` \(nit\): Name the constant\./);
});

test("a follow-up of a follow-up is titled after the first origin, and depends on its own", () => {
  const second = issueIdSchema.parse("WEB-9");
  const plan = followUpPlan(second, { id: ORIGIN, title: "Add retries" }, [{ round: 1, leftovers: [shouldFix] }]);
  assert.equal(plan?.title, "Follow-ups from WEB-4: Add retries");
  assert.deepEqual(plan?.dependsOn, [second]);
  assert.match(plan?.brief ?? "", /The reviews of WEB-9 held/);
});

test("a description lists as many findings as fit its 2,000 characters, then how many more the brief lists", () => {
  const many = Array.from({ length: 40 }, (_, i): Triaged => ({ ...shouldFix, claim: `Finding ${i}: ${"x".repeat(60)}` }));
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Add retries" }, [{ round: 1, leftovers: many }]);
  const description = plan?.description ?? assert.fail("no plan");
  assert.ok(description.length <= 2_000, `${description.length} characters`);
  const listed = description.split("\n").filter((line) => line.startsWith("- ")).length;
  assert.ok(listed > 0 && listed < 40);
  assert.ok(description.endsWith(`… and ${40 - listed} more, each in the brief.`));
  assert.equal((plan?.brief ?? "").split("Finding ").length - 1, 40, "the brief lists every one");
});

test("a title past the 80 characters an issue's title holds is cut with an ellipsis", () => {
  const plan = followUpPlan(ORIGIN, { id: ORIGIN, title: "Retry failed webhook deliveries with exponential backoff and a cap on attempts" }, [{ round: 1, leftovers: [shouldFix] }]);
  assert.equal(plan?.title, "Follow-ups from WEB-4: Retry failed webhook deliveries with exponential backoff…");
  assert.equal(plan?.title.length, 80);
});

test("a check's leftovers are what it held without failing it: an anchored must-fix and a rejected finding are not, and an unreturned verdict has none", () => {
  const anchored: Triaged = { ...PLACE, severity: "must-fix", claim: "Retries drop the payload.", result: "anchored", anchor: "criterion", reason: "Criterion 2 fails." };
  const rejected: Triaged = { ...PLACE, severity: "should-fix", claim: "Use a queue.", result: "rejected", reason: "Out of scope." };
  const verdict: Verdict = {
    state: "returned",
    at: 5_000,
    verifierThreadId: "thr_v",
    headSha: SHA,
    checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
    criteria: [{ criterion: "npm test passes", result: "pass", evidence: "ok" }],
    findings: [],
    triage: [anchored, shouldFix, rejected, downgraded, nit],
    mustFixFails: true,
    model: { providerId: "codex", model: "gpt-default" },
    sameModel: false,
    settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
  };
  assert.deepEqual(leftoversOf({ verdict }), [shouldFix, downgraded, nit]);
  assert.deepEqual(leftoversOf({ verdict: { state: "queued", checkout: null } }), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { statusCheckRollupSchema, summarizeChecks } from "./checks.ts";

type Outcome = "passing" | "failing" | "pending";

// Shaped as `gh pr view --json statusCheckRollup` prints them; the extra fields are gh's.
type Check = { name: string; item: object };
const checkRun = (status: string, conclusion: string): Check => ({
  name: `CheckRun ${status} ${conclusion || "(no conclusion)"}`,
  item: { __typename: "CheckRun", name: "check", workflowName: "CI", status, conclusion, detailsUrl: "https://github.com/o/r/actions/runs/1/job/2" },
});
const statusContext = (state: string): Check => ({
  name: `StatusContext ${state}`,
  item: { __typename: "StatusContext", context: "ci/legacy", state, targetUrl: "https://ci.example/1" },
});

const cases: [check: Check, outcome: Outcome][] = [
  [checkRun("COMPLETED", "SUCCESS"), "passing"],
  [checkRun("COMPLETED", "NEUTRAL"), "passing"],
  [checkRun("COMPLETED", "SKIPPED"), "passing"],
  [checkRun("COMPLETED", "FAILURE"), "failing"],
  [checkRun("COMPLETED", "CANCELLED"), "failing"],
  [checkRun("COMPLETED", "TIMED_OUT"), "failing"],
  [checkRun("COMPLETED", "ACTION_REQUIRED"), "failing"],
  [checkRun("COMPLETED", "STARTUP_FAILURE"), "failing"],
  [checkRun("COMPLETED", "STALE"), "failing"],
  [checkRun("IN_PROGRESS", ""), "pending"],
  [checkRun("QUEUED", ""), "pending"],
  [checkRun("WAITING", ""), "pending"],
  [checkRun("PENDING", ""), "pending"],
  [checkRun("REQUESTED", ""), "pending"],
  [statusContext("SUCCESS"), "passing"],
  [statusContext("FAILURE"), "failing"],
  [statusContext("ERROR"), "failing"],
  [statusContext("PENDING"), "pending"],
  [statusContext("EXPECTED"), "pending"],
];

const summaryOf = (checks: Check[]) => summarizeChecks(statusCheckRollupSchema.parse(checks.map((check) => check.item)));
const only = (outcome: Outcome) => ({ passing: 0, failing: 0, pending: 0, [outcome]: 1 });

for (const [check, outcome] of cases) {
  test(`summarizeChecks counts ${check.name} as ${outcome}`, () => {
    assert.deepEqual(summaryOf([check]), only(outcome));
  });
}

test("summarizeChecks counts a status, conclusion or state GitHub adds later as pending", () => {
  const rollup = [checkRun("BRAND_NEW_STATUS", ""), checkRun("COMPLETED", "BRAND_NEW_CONCLUSION"), statusContext("BRAND_NEW_STATE")];
  assert.deepEqual(summaryOf(rollup), { passing: 0, failing: 0, pending: 3 });
});

test("summarizeChecks counts a rollup item kind GitHub adds later as pending", () => {
  const rollup = [{ name: "BrandNewCheck", item: { __typename: "BrandNewCheck", outcome: "WHATEVER" } }, checkRun("COMPLETED", "SUCCESS")];
  assert.deepEqual(summaryOf(rollup), { passing: 1, failing: 0, pending: 1 });
});

test("summarizeChecks counts a mixed rollup by outcome", () => {
  const rollup = [checkRun("COMPLETED", "SUCCESS"), checkRun("COMPLETED", "SKIPPED"), statusContext("ERROR"), checkRun("IN_PROGRESS", "")];
  assert.deepEqual(summaryOf(rollup), { passing: 2, failing: 1, pending: 1 });
});

test("summarizeChecks gives all zeros for a PR with no checks", () => {
  assert.deepEqual(summaryOf([]), { passing: 0, failing: 0, pending: 0 });
});

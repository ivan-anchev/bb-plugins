import assert from "node:assert/strict";
import { test } from "node:test";
import { outcome, verdictSchema, type CriterionResult, type Outcome, type Verdict } from "./verdict.ts";

const returned = (results: CriterionResult[], settlement: Settlement = { kind: "checked", refused: null }): Verdict => ({
  state: "returned",
  verifierThreadId: "thr_v",
  headSha: "a".repeat(40),
  criteria: results.map((result, i) => ({ criterion: `criterion ${i + 1}`, result, evidence: "ran it" })),
  findings: [],
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  settlement,
});

type Settlement = Extract<Verdict, { state: "returned" }>["settlement"];

test("a verdict's outcome is derived from its state, and a returned one from every criterion", () => {
  const cases: [Verdict, Outcome][] = [
    [{ state: "queued" }, "pending"],
    [{ state: "running", verifierThreadId: "thr_v", nudged: true }, "pending"],
    [returned(["pass"]), "pass"],
    [returned(["pass", "pass", "pass"]), "pass"],
    [returned(["pass", "fail"]), "fail"],
    [{ state: "could-not-run", verifierThreadId: null, reason: "bb did not start a verifier" }, "could-not-run"],
    [{ state: "superseded" }, "superseded"],
    [{ state: "waived" }, "unverified"],
  ];
  for (const [verdict, expected] of cases) assert.equal(outcome(verdict), expected, JSON.stringify(verdict));
});

test("a criterion the verifier couldn't check is not a pass", () => {
  assert.equal(outcome(returned(["pass", "unverifiable"])), "fail");
  assert.equal(outcome(returned(["unverifiable"])), "fail");
});

test("a returned verdict is pending until it is settled: its findings reached the crew, or it is checked", () => {
  const cases: [Settlement, Outcome][] = [
    [{ kind: "pending" }, "pending"],
    [{ kind: "sending-back", round: 1 }, "pending"],
    [{ kind: "sent-back", round: 1 }, "fail"],
    [{ kind: "checked", refused: null }, "fail"],
  ];
  for (const [settlement, expected] of cases) assert.equal(outcome(returned(["fail"], settlement)), expected, settlement.kind);
});

test("a verdict stored before settlements existed reads as settled", () => {
  const stored = verdictSchema.parse({ state: "returned", verifierThreadId: "thr_v", headSha: "a".repeat(40), criteria: [{ criterion: "npm test passes", result: "pass", evidence: "ran it" }], findings: [], model: { providerId: "codex", model: "gpt-default" }, sameModel: false });
  assert.equal(outcome(stored), "pass");
});

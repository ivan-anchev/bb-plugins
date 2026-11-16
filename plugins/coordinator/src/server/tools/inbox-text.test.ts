import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffIdSchema, type Handoff } from "../../model/handoff.ts";
import { coordinatorIdSchema, crewIdSchema } from "../../model/role.ts";
import { outcome, type CriterionResult, type Verdict } from "../../model/verdict/verdict.ts";
import { handoffText } from "./inbox-text.ts";

const doneWith = (verdict: Verdict): Handoff => ({
  id: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"),
  coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
  crewId: crewIdSchema.parse("c1"),
  at: 1_000,
  turnSeq: 1,
  status: "done",
  summary: "Retries land with backoff",
  did: [],
  evidence: [],
  concerns: [],
  deviations: [],
  findings: [],
  headSha: "0123456789abcdef0123456789abcdef01234567",
  prUrl: null,
  verdict,
});

const returned = (results: CriterionResult[]): Verdict => ({
  state: "returned",
  verifierThreadId: "thr_v",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  criteria: results.map((result) => ({ criterion: "npm test passes", result, evidence: "ran npm test" })),
  findings: [],
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
});

test("a returned verdict reads Verified in catch-up exactly when outcome() passes it, with its count beside", () => {
  const cases: [CriterionResult[], number][] = [
    [["pass"], 1],
    [["pass", "pass"], 2],
    [["pass", "fail"], 1],
    [["pass", "unverifiable"], 1],
    [["unverifiable"], 0],
    [["fail", "fail"], 0],
  ];
  for (const [results, passed] of cases) {
    const verdict = returned(results);
    const label = outcome(verdict) === "pass" ? "Verified" : "Failed verification";
    assert.match(handoffText(doneWith(verdict)), new RegExp(`#### Verdict\\n\\n${label}: ${passed} of ${results.length} criteria passed,`), results.join(", "));
  }
});

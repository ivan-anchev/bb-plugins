import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { agentIdSchema } from "../../agent/agent.ts";
import { handoffIdSchema } from "../../agent/handoff.ts";
import { decisionIdSchema } from "../../decision.ts";
import { issueIdSchema } from "../../issue/issue.ts";
import { coordinatorIdSchema } from "../../role.ts";
import { checkIdSchema, type Check, type CheckSubject } from "../check.ts";
import type { Verdict } from "../verdict.ts";
import { askedBy, capAsks, countedFailures, mayGoBack, type CapQuestion } from "./cap.ts";

const ISSUE = issueIdSchema.parse("WEB-1");
const A1 = agentIdSchema.parse("a1");
const A2 = agentIdSchema.parse("a2");
const SHA = "a".repeat(40);

type Settlement = Extract<Verdict, { state: "returned" }>["settlement"];
const CHECKED: Settlement = { kind: "checked", refused: null, ci: { kind: "none" } };

/** A verdict its verifier returned, settled as `settlement`, failing one of two criteria or passing both. */
const returned = (passed: boolean, settlement: Settlement = CHECKED): Verdict => ({
  state: "returned",
  at: 5_000,
  verifierThreadId: "thr_v",
  headSha: SHA,
  checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
  criteria: [
    { criterion: "npm test passes", result: "pass", evidence: "ok" },
    { criterion: "npm run lint passes", result: passed ? "pass" : "fail", evidence: passed ? "ok" : "2 errors" },
  ],
  findings: [],
  triage: [],
  mustFixFails: true,
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  settlement,
});
const FAILED = returned(false);

const handoffBy = (agentId: typeof A1): CheckSubject => ({ kind: "handoff", agentId, handoffId: handoffIdSchema.parse(randomUUID()), headSha: SHA, prUrl: null });

/** One entry of an issue's record: a check of `subject` with this verdict, as the store reads it. */
function handed(verdict: Verdict, subject: CheckSubject = handoffBy(A1)): { check: Check } {
  return {
    check: {
      id: checkIdSchema.parse(randomUUID()),
      coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
      issueId: ISSUE,
      at: 3_000,
      criteria: ["npm test passes", "npm run lint passes"],
      verifier: null,
      subject,
      review: { state: "none" },
      verdict,
    },
  };
}

/** A cap question about WEB-1, asked at `cap`, answered or not. */
const question = (n: number, cap: number, answered: boolean): CapQuestion => ({
  id: decisionIdSchema.parse(`d${n}`),
  issueId: ISSUE,
  question: "Anything",
  options: ["One more round", "Cancel it"],
  askedAt: 6_000,
  answer: answered ? { text: "One more round", at: 7_000 } : null,
  cap,
});

/** What settling one more failure on this record asks at (null: nothing), as the settle transaction counts it, the failure included. */
const asksAfter = (record: readonly { check: Check | null }[], questions: readonly CapQuestion[]): number | null => capAsks(countedFailures([...record, handed(FAILED)]).length, questions);

test("three failed handoff verdicts across two agents ask at 3, and nothing before; a handover doesn't reset the count", () => {
  const first = [handed(FAILED, handoffBy(A1)), handed(returned(false, { kind: "sent-back", round: 1, ci: { kind: "none" } }), handoffBy(A1))];
  assert.equal(capAsks(countedFailures(first.slice(0, 1)).length, []), null, "one failure asks nothing");
  assert.equal(capAsks(countedFailures(first).length, []), null, "two failures, one of them sent back, ask nothing");
  const third = [...first, handed(FAILED, handoffBy(A2))];
  assert.equal(countedFailures(third).length, 3);
  assert.equal(capAsks(countedFailures(third).length, []), 3, "the third, by a fresh agent, asks at 3");
  assert.equal(mayGoBack(3, []), false, "and it goes back to nobody");
  assert.equal(mayGoBack(2, []), true, "while the second may");
});

test("could-not-run, superseded, final, passed and still-pending checks don't count; a blocked handoff with no check doesn't either", () => {
  const record = [
    handed(FAILED),
    handed({ state: "could-not-run", at: 5_000, verifierThreadId: null, reason: "bb did not start a verifier" }),
    handed({ state: "superseded" }),
    handed(returned(false, { kind: "superseded" })),
    handed(FAILED, { kind: "final", defaultBranch: "main", merged: [] }),
    handed(returned(true)),
    handed(returned(false, { kind: "pending" })),
    handed({ state: "waived" }),
    { check: null },
    handed(FAILED, handoffBy(A2)),
  ];
  assert.deepEqual(countedFailures(record).map(({ id }) => id), [record[0]?.check?.id, record[9]?.check?.id]);
  assert.equal(asksAfter(record, []), 3, "the next failure is the third");
});

test("nothing asks while a cap question is open, and a failure then goes back to nobody", () => {
  const atCap = [handed(FAILED), handed(FAILED), handed(FAILED)];
  assert.equal(asksAfter(atCap, [question(1, 3, false)]), null);
  assert.equal(mayGoBack(4, [question(1, 3, false)]), false, "nothing goes back while it is open");
  assert.equal(asksAfter(atCap, [question(1, 3, true), question(2, 4, false)]), null, "nor while a later one is");
});

test("an answered question at 3 makes the 4th failure ask, at 4; once that is answered, the 5th asks at 5", () => {
  const atCap = [handed(FAILED), handed(FAILED), handed(FAILED)];
  assert.equal(asksAfter(atCap, [question(1, 3, true)]), 4);
  assert.equal(asksAfter([...atCap, handed(FAILED)], [question(1, 3, true), question(2, 4, true)]), 5);
  assert.equal(capAsks(3, [question(1, 3, true)]), null, "the failure it was asked at never asks again");
});

test("an issue five failures deep with no question, as one failing before the cap existed, asks at its 6th", () => {
  const before = Array.from({ length: 5 }, () => handed(FAILED));
  assert.equal(asksAfter(before, []), 6);
});

test("each question is marked on the failure it was asked at, by the order the failures were handed off", () => {
  const record = [handed(FAILED, handoffBy(A1)), handed({ state: "superseded" }), handed(FAILED, handoffBy(A1)), handed(FAILED, handoffBy(A2)), handed(FAILED, handoffBy(A2))];
  const asked = askedBy(countedFailures(record), [question(1, 3, true), question(2, 4, false)]);
  assert.deepEqual(
    record.map(({ check }) => asked.get(check.id)?.id ?? null),
    [null, null, null, "d1", "d2"],
  );
});

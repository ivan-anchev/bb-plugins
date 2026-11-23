import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../agent/agent.ts";
import { handoffIdSchema, type Handoff } from "../agent/handoff.ts";
import { issueIdSchema } from "../issue/issue.ts";
import type { Handed } from "../issue/status.ts";
import { coordinatorIdSchema } from "../role.ts";
import { checkIdSchema, type Check, type FinalCheck } from "../verdict/check.ts";
import type { Review, ReviewFinding, Triaged } from "../verdict/review.ts";
import type { Verdict } from "../verdict/verdict.ts";
import { bodyOf, finalRoundOf, roundOf } from "./round.ts";

// A round's review: its step on the rail with how many findings the reviewer reported and the
// verifier confirmed; opened, each finding with its triage once the verdict returned.

const MANAGER = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
const BBP_19 = issueIdSchema.parse("BBP-19");
const A1 = agentIdSchema.parse("a1");
const SHA = "a".repeat(40);
const REVIEWED_AT = 3_200;

const HANDOFF: Handoff = {
  id: handoffIdSchema.parse("00000000-0000-4000-8000-000000000001"),
  coordinatorId: MANAGER,
  issueId: BBP_19,
  agentId: A1,
  at: 3_000,
  turnSeq: 1,
  summary: "Retries land",
  did: [],
  evidence: [],
  concerns: [],
  deviations: [],
  findings: [],
  status: "done",
  delivery: { kind: "commit", headSha: SHA, prUrl: null },
};

const TRIAGE: Triaged[] = [
  { file: "src/retry.ts", line: 4, severity: "must-fix", claim: "The backoff has no cap.", result: "confirmed", reason: "Seen: it grows without bound." },
  { file: "src/retry.css", line: null, severity: "nit", claim: "The padding differs from the row's.", result: "rejected", reason: "It matches the row." },
  { file: "src/retry.test.ts", line: 12, severity: "should-fix", claim: "No test retries after a failure.", result: "confirmed", reason: "Only the first attempt is tested." },
];
const FINDINGS: ReviewFinding[] = TRIAGE.map(({ result: _result, reason: _reason, ...finding }) => finding);
const REPORTED: Review = { state: "reported", at: REVIEWED_AT, reviewerThreadId: "thr_reviewer", findings: FINDINGS, model: { providerId: "codex", model: "gpt-5.4" } };

const RETURNED: Verdict = {
  state: "returned",
  at: 3_500,
  verifierThreadId: "thr_verifier",
  headSha: SHA,
  checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
  criteria: [{ criterion: "npm test passes", result: "fail", evidence: "1 failing" }],
  findings: [],
  triage: TRIAGE,
  mustFixFails: true,
  model: { providerId: "claude-code", model: "sonnet" },
  sameModel: false,
  settlement: { kind: "sent-back", round: 1, ci: { kind: "none" } },
};
const RUNNING: Verdict = { state: "running", verifierThreadId: "thr_verifier", nudged: false, declined: [], checkout: null };

function handed(review: Review, verdict: Verdict): Handed & { check: Check } {
  const check: Check = { id: checkIdSchema.parse("00000000-0000-4000-8000-000000000101"), coordinatorId: MANAGER, issueId: BBP_19, at: HANDOFF.at, criteria: ["npm test passes"], verifier: null, subject: { kind: "handoff", agentId: A1, handoffId: HANDOFF.id, headSha: SHA, prUrl: null }, review, verdict };
  return { handoff: HANDOFF, check };
}

test("a reported review counts its findings and, once the verdict triaged them, the ones it confirmed; opened, each finding carries its triage", () => {
  const made = handed(REPORTED, RETURNED);
  assert.deepEqual(roundOf(made, 1, null).review, { state: "reported", findings: 3, confirmed: 2, step: { at: REVIEWED_AT } });
  const { findings } = bodyOf(made.handoff, made.check);
  assert.deepEqual(findings[1]?.triage, { result: "rejected", reason: "It matches the row." });
  assert.deepEqual(
    findings.map(({ triage }) => triage?.result),
    ["confirmed", "rejected", "confirmed"],
    "each triage on its own finding, in the review's order",
  );
  assert.deepEqual(findings.map(({ file, line, severity, claim }) => ({ file, line, severity, claim })), FINDINGS, "each finding as the reviewer wrote it");
});

test("before the verdict returns, the findings show with no triage yet and nothing is counted as confirmed", () => {
  const made = handed(REPORTED, RUNNING);
  assert.deepEqual(roundOf(made, 1, null).review, { state: "reported", findings: 3, confirmed: null, step: { at: REVIEWED_AT } });
  assert.deepEqual(
    bodyOf(made.handoff, made.check).findings.map(({ triage }) => triage),
    [null, null, null],
  );
});

test("a missed review's spine says only that it was missed, and when; why is the body's, read when the round opens", () => {
  const made = handed({ state: "missed", at: 3_100, reviewerThreadId: null, reason: "no reviewer model" }, RUNNING);
  assert.deepEqual(roundOf(made, 1, null).review, { state: "missed", step: { at: 3_100 } });
  assert.equal(bodyOf(made.handoff, made.check).reviewMissed, "no reviewer model");
  assert.equal(bodyOf(HANDOFF, null).reviewMissed, null);
});

test("a build parent's final check reviews no diff: its round has no review", () => {
  const final: FinalCheck = { id: checkIdSchema.parse("00000000-0000-4000-8000-000000000201"), coordinatorId: MANAGER, issueId: BBP_19, at: 7_000, criteria: ["npm test passes"], verifier: null, subject: { kind: "final", defaultBranch: "main", merged: [] }, review: { state: "none" }, verdict: { state: "waived" } };
  assert.deepEqual(finalRoundOf(final, 1, null).review, { state: "none" });
  assert.deepEqual(bodyOf(null, final).findings, []);
});

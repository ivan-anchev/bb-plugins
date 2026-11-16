import assert from "node:assert/strict";
import { test } from "node:test";
import type { Crew } from "./crew.ts";
import { crewState, type BoardState, type CrewThread } from "./crew-state.ts";
import { handoffIdSchema, handoffIsCurrent, type Handoff } from "./handoff.ts";
import { coordinatorIdSchema, crewIdSchema } from "./role.ts";
import type { CriterionResult, Verdict } from "./verdict/verdict.ts";

const crew: Crew = {
  id: crewIdSchema.parse("c1"),
  coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
  title: "Add retries to the webhook sender",
  brief: "Retry failed deliveries with backoff.",
  doneCriteria: ["npm test passes"],
  placement: { kind: "worktree" },
  execution: null,
  launch: { kind: "started", threadId: "thr_1" },
  closed: null,
  fixRounds: 0,
  createdAt: 1_000,
};
const thread = (status: CrewThread["status"], hasPendingInteraction = false): CrewThread => ({ status, hasPendingInteraction });

const report = { summary: "Retries land with backoff", did: ["Added backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [] };
const meta = { id: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), coordinatorId: crew.coordinatorId, crewId: crew.id, at: 5_000, turnSeq: 7 };
const done: Handoff = { ...meta, ...report, status: "done", headSha: "a".repeat(40), prUrl: null, verdict: { state: "waived" } };
const blocked: Handoff = { ...meta, ...report, status: "blocked", summary: "Needs a staging key" };
const gaveUp: Handoff = { ...meta, ...report, status: "gave-up", summary: "The queue API rejects batches" };

test("a running crew is Working", () => {
  for (const status of ["active", "starting", "pending", "stopping"] as const) assert.equal(crewState(crew, thread(status), null, null).state, "working", status);
  assert.deepEqual(crewState(crew, thread("active"), null, null), { state: "working", headline: "Working" });
});

test("a crew whose turn ended is Idle", () => {
  assert.deepEqual(crewState(crew, thread("idle"), null, null), { state: "idle", headline: "Its turn ended without a handoff" });
});

test("a crew waiting on an approval or a question Needs you, even while its turn runs", () => {
  assert.deepEqual(crewState(crew, thread("active", true), null, null), { state: "needs-you", headline: "Waiting for an answer or an approval in its thread" });
});

test("a crew whose turn failed Needs you", () => {
  assert.deepEqual(crewState(crew, thread("error"), null, null), { state: "needs-you", headline: "Its last turn failed" });
});

test("a draft, saved for the user or never confirmed by bb, Needs you under its title", () => {
  assert.deepEqual(crewState({ ...crew, launch: { kind: "draft" } }, null, null, null), { state: "needs-you", headline: "Draft: Add retries to the webhook sender" });
});

test("a closed crew is Done, whatever its thread is doing", () => {
  assert.deepEqual(crewState({ ...crew, closed: { kind: "stopped", at: 2_000 } }, thread("idle"), null, null), { state: "done", headline: "Stopped" });
  assert.deepEqual(crewState({ ...crew, closed: { kind: "resolved", at: 2_000 } }, thread("active"), null, null), { state: "done", headline: "Resolved" });
});

test("a crew whose thread bb no longer lists is Done", () => {
  assert.deepEqual(crewState(crew, null, null, null), { state: "done", headline: "Its thread was archived or deleted" });
});

test("a thread status newer than this plugin's SDK reads as Idle, never throws", () => {
  // why the cast: it stands in for a status a newer bb sends, which this SDK's type can't name.
  const fromNewerHost = { status: "hibernating", hasPendingInteraction: false } as unknown as CrewThread;
  assert.equal(crewState(crew, fromNewerHost, null, null).state, "idle");
});

test("a handoff is current until its thread starts a later turn, whatever the clock says", () => {
  assert.equal(handoffIsCurrent(done, 7), true);
  assert.equal(handoffIsCurrent(done, 8), false);
  const madeLater: Handoff = { ...done, at: Number.MAX_SAFE_INTEGER };
  assert.equal(handoffIsCurrent(madeLater, 8), false, "a later timestamp does not make it current");
  assert.equal(handoffIsCurrent(done, null), true, "with no turn listed, no later turn started");
});

test("an idle crew with a current done handoff is Ready for review, marked Unverified", () => {
  assert.deepEqual(crewState(crew, thread("idle"), done, null), { state: "ready-for-review", headline: "Unverified: Retries land with backoff" });
});

test("an idle crew that is blocked or gave up Needs you, with its summary", () => {
  assert.deepEqual(crewState(crew, thread("idle"), blocked, null), { state: "needs-you", headline: "Blocked: Needs a staging key" });
  assert.deepEqual(crewState(crew, thread("idle"), gaveUp, null), { state: "needs-you", headline: "Gave up: The queue API rejects batches" });
});

test("after a handoff, a new turn makes the crew Working, and its end with no new handoff Idle", () => {
  // The user typed into the crew's thread: turn 8 started after the handoff from turn 7.
  const current = (latestTurnSeq: number) => (handoffIsCurrent(done, latestTurnSeq) ? done : null);
  assert.equal(crewState(crew, thread("active"), current(8), null).state, "working");
  assert.deepEqual(crewState(crew, thread("idle"), current(8), null), { state: "idle", headline: "Its turn ended without a handoff" });
});

test("a crew waiting on the user or failed Needs you, even with a current handoff", () => {
  assert.equal(crewState(crew, thread("idle", true), done, null).state, "needs-you");
  assert.equal(crewState(crew, thread("error"), done, null).headline, "Its last turn failed");
});

test("an idle crew's done handoff is placed by its verdict, for every verdict state", () => {
  const checked = (results: CriterionResult[]): Verdict => ({
    state: "returned",
    verifierThreadId: "thr_v",
    headSha: "a".repeat(40),
    criteria: results.map((result) => ({ criterion: "npm test passes", result, evidence: "npm test: 1 failing" })),
    findings: [],
    model: { providerId: "codex", model: "gpt-default" },
    sameModel: false,
    settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
  });
  const cases: [Verdict, BoardState, string][] = [
    [{ state: "queued" }, "verifying", "Verifying: Retries land with backoff"],
    [{ state: "running", verifierThreadId: "thr_v", nudged: false }, "verifying", "Verifying: Retries land with backoff"],
    [checked(["pass", "pass"]), "ready-for-review", "✓ Verified: Retries land with backoff"],
    [checked(["pass", "fail"]), "needs-you", "✗ Failed verification: Retries land with backoff"],
    [checked(["unverifiable"]), "needs-you", "✗ Failed verification: Retries land with backoff"],
    [{ state: "could-not-run", verifierThreadId: "thr_v", reason: "its verifier stopped without a verdict" }, "needs-you", "Couldn't verify: Retries land with backoff"],
    [{ state: "superseded" }, "idle", "Replaced by a newer handoff: Retries land with backoff"],
    [{ state: "waived" }, "ready-for-review", "Unverified: Retries land with backoff"],
  ];
  for (const [verdict, state, headline] of cases) {
    assert.deepEqual(crewState(crew, thread("idle"), { ...done, verdict }, null), { state, headline }, JSON.stringify(verdict));
  }
});

test("a failed verdict after the crew's fix round says so", () => {
  const failed: Verdict = { state: "returned", verifierThreadId: "thr_v", headSha: "a".repeat(40), criteria: [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }], findings: [], model: { providerId: "codex", model: "gpt-default" }, sameModel: false, settlement: { kind: "checked", refused: null, ci: { kind: "none" } } };
  assert.deepEqual(crewState({ ...crew, fixRounds: 1 }, thread("idle"), { ...done, verdict: failed }, null), { state: "needs-you", headline: "✗ Failed verification after its fix round: Retries land with backoff" });
});

test("a failed verdict whose findings may or may not have reached the crew says so, not that it failed again", () => {
  const failed: Verdict = { state: "returned", verifierThreadId: "thr_v", headSha: "a".repeat(40), criteria: [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }], findings: [], model: { providerId: "codex", model: "gpt-default" }, sameModel: false, settlement: { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } } };
  assert.deepEqual(crewState({ ...crew, fixRounds: 1 }, thread("idle"), { ...done, verdict: failed }, null), { state: "needs-you", headline: "✗ Failed verification, its findings may or may not have reached it: Retries land with backoff" });
});

test("a crew whose verifier is checking its done handoff is still Working once someone types into it", () => {
  assert.equal(crewState(crew, thread("active"), { ...done, verdict: { state: "running", verifierThreadId: "thr_v", nudged: false } }, null).state, "working");
});

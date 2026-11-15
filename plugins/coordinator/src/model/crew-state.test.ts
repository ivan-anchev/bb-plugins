import assert from "node:assert/strict";
import { test } from "node:test";
import type { Crew } from "./crew.ts";
import { crewState, type CrewThread } from "./crew-state.ts";
import { coordinatorIdSchema, crewIdSchema } from "./role.ts";

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
  createdAt: 1_000,
};
const thread = (status: CrewThread["status"], hasPendingInteraction = false): CrewThread => ({ status, hasPendingInteraction });

test("a running crew is Working", () => {
  for (const status of ["active", "starting", "pending", "stopping"] as const) assert.equal(crewState(crew, thread(status)).state, "working", status);
  assert.deepEqual(crewState(crew, thread("active")), { state: "working", headline: "Working" });
});

test("a crew whose turn ended is Idle", () => {
  assert.deepEqual(crewState(crew, thread("idle")), { state: "idle", headline: "Its turn ended: waiting for a message" });
});

test("a crew waiting on an approval or a question Needs you, even while its turn runs", () => {
  assert.deepEqual(crewState(crew, thread("active", true)), { state: "needs-you", headline: "Waiting for an answer or an approval in its thread" });
});

test("a crew whose turn failed Needs you", () => {
  assert.deepEqual(crewState(crew, thread("error")), { state: "needs-you", headline: "Its last turn failed" });
});

test("a draft, saved for the user or never confirmed by bb, Needs you under its title", () => {
  assert.deepEqual(crewState({ ...crew, launch: { kind: "draft" } }, null), { state: "needs-you", headline: "Draft: Add retries to the webhook sender" });
});

test("a closed crew is Done, whatever its thread is doing", () => {
  assert.deepEqual(crewState({ ...crew, closed: { kind: "stopped", at: 2_000 } }, thread("idle")), { state: "done", headline: "Stopped" });
  assert.deepEqual(crewState({ ...crew, closed: { kind: "resolved", at: 2_000 } }, thread("active")), { state: "done", headline: "Resolved" });
});

test("a crew whose thread bb no longer lists is Done", () => {
  assert.deepEqual(crewState(crew, null), { state: "done", headline: "Its thread was archived or deleted" });
});

test("a thread status newer than this plugin's SDK reads as Idle, never throws", () => {
  // why the cast: it stands in for a status a newer bb sends, which this SDK's type can't name.
  const fromNewerHost = { status: "hibernating", hasPendingInteraction: false } as unknown as CrewThread;
  assert.equal(crewState(crew, fromNewerHost).state, "idle");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread } from "./fixtures.ts";
import { askOf, baseState, stateOf, withAsk, withWait, type ZState } from "./state.ts";

const EXPECTED: Record<PluginSidebarThread["indicator"], ZState | null> = {
  "waiting-for-input": "input",
  "unread-error": "failed",
  "queued-failed": "failed",
  "unread-success": "done",
  runtime: "working",
  "plan-mode": "working",
  goal: "working",
  workflow: "working",
  "queued-waiting": "working",
  "working-draft": "working",
  "background-agent": "waiting",
  "background-command": "waiting",
  draft: null,
  none: null,
};

test("every bb indicator maps to one Zeron state", () => {
  for (const [indicator, state] of Object.entries(EXPECTED)) {
    assert.equal(baseState(thread("t", { indicator: indicator as PluginSidebarThread["indicator"] })), state, indicator);
  }
});

test("a runtime on a machine that isn't ready is connecting", () => {
  assert.equal(baseState(thread("t", { indicator: "runtime", runtimeStatus: "provisioning" })), "connecting");
  assert.equal(baseState(thread("t", { indicator: "runtime", runtimeStatus: "waiting-for-host" })), "connecting");
});

test("an indicator from a newer bb draws no state", () => {
  // why: deliberately off-type — stands in for a kind this plugin's SDK doesn't know yet.
  const newer = { ...thread("t"), indicator: "teleporting" } as unknown as PluginSidebarThread;
  assert.equal(baseState(newer), null);
});

test("a woken sleeper shows Woke unless it has something more to say", () => {
  const sleep = { threadId: "t", until: 1_000 };
  assert.equal(stateOf(null, sleep, 2_000), "woke");
  assert.equal(stateOf("done", sleep, 2_000), "woke");
  assert.equal(stateOf("input", sleep, 2_000), "input");
  assert.equal(stateOf("waiting", sleep, 2_000), "waiting", "something will still wake it");
  assert.equal(stateOf(null, sleep, 500), null, "still asleep");
  assert.equal(stateOf("done", undefined, 2_000), "done");
});

test("something to wake it turns a settled turn Waiting; nothing else moves", () => {
  assert.equal(withWait(null, true), "waiting");
  assert.equal(withWait("done", true), "waiting");
  const others: ZState[] = ["working", "connecting", "waiting", "input", "approval", "failed", "woke"];
  for (const state of others) assert.equal(withWait(state, true), state, state);
  assert.equal(withWait("done", false), "done");
});

test("an approval asked turns Awaiting Input into Pending Approval; a question, or not knowing yet, leaves it", () => {
  assert.equal(withAsk("input", "approval"), "approval");
  assert.equal(withAsk("input", "question"), "input");
  assert.equal(withAsk("input", null), "input");
});

test("what is asked moves no other state", () => {
  const others: ZState[] = ["working", "connecting", "waiting", "done", "failed", "woke"];
  for (const state of others) assert.equal(withAsk(state, "approval"), state, state);
});

test("a thread asks for approval when any pending interaction is one", () => {
  const question = { status: "pending", payload: { kind: "user_question" } } as const;
  const approval = { status: "pending", payload: { kind: "approval" } } as const;
  assert.equal(askOf([question, approval]), "approval");
  assert.equal(askOf([approval]), "approval");
});

test("a thread asks a question when no pending interaction is an approval", () => {
  assert.equal(askOf([{ status: "pending", payload: { kind: "user_question" } }]), "question");
  assert.equal(askOf([{ status: "pending", payload: { kind: "plugin" } }]), "question");
  // why: an approval already answered no longer asks.
  assert.equal(askOf([{ status: "resolved", payload: { kind: "approval" } }, { status: "pending", payload: { kind: "user_question" } }]), "question");
  assert.equal(askOf([]), "question");
});

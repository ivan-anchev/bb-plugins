import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread } from "./fixtures.ts";
import { baseState, stateOf, type ZState } from "./state.ts";

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
  assert.equal(stateOf(thread("t"), sleep, 2_000), "woke");
  assert.equal(stateOf(thread("t", { indicator: "unread-success" }), sleep, 2_000), "woke");
  assert.equal(stateOf(thread("t", { indicator: "waiting-for-input" }), sleep, 2_000), "input");
  assert.equal(stateOf(thread("t"), sleep, 500), null, "still asleep");
  assert.equal(stateOf(thread("t", { indicator: "unread-success" }), undefined, 2_000), "done");
});

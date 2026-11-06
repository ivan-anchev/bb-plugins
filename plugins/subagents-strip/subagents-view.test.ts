import assert from "node:assert/strict";
import { test } from "node:test";
import type { Delegate, DelegateId, DelegateState, Turn } from "./delegate.ts";
import { selectBatches } from "./roster.ts";
import { EMPTY_VIEW, isOpen, landOn, toggleBatch, toggleRow } from "./subagents-view.ts";

// Three prompts: t1's batch is settled, t2's holds a failure, t3's is the latest.
const turns: Turn[] = [prompt("t1", 0), prompt("t2", 100), prompt("t3", 200)];
const delegates = [
  delegate("old", 10, { status: "completed", endedAt: 20, report: null }),
  delegate("failed", 110, { status: "failed", endedAt: 120, error: null }),
  delegate("latest", 210, { status: "completed", endedAt: 220, report: null }),
];
const batches = selectBatches(delegates, turns); // newest first: t3, t2, t1
const [t3, t2, t1] = batches;

test("a batch follows its default until the user toggles it", () => {
  assert.deepEqual(batches.map((b) => isOpen(EMPTY_VIEW, b)), [true, false, false]);
  const opened = toggleBatch(EMPTY_VIEW, t2, batches);
  assert.deepEqual(batches.map((b) => isOpen(opened, b)), [true, true, false]);
  assert.equal(isOpen(toggleBatch(EMPTY_VIEW, t3, batches), t3), false, "the latest batch closes too");
});

test("closing a batch closes the row expanded in it; closing another leaves it", () => {
  const expanded = toggleRow(toggleBatch(EMPTY_VIEW, t2, batches), id("failed"), batches);
  assert.equal(toggleBatch(expanded, t1, batches).expanded, "failed");
  assert.equal(toggleBatch(expanded, t2, batches).expanded, null);
});

test("one row is expanded at a time, and toggling it again collapses it", () => {
  const first = toggleRow(EMPTY_VIEW, id("latest"), batches);
  assert.equal(toggleRow(first, id("old"), batches).expanded, "old");
  assert.equal(toggleRow(first, id("latest"), batches).expanded, null);
});

test("a landing expands its row and opens its batch, even one the user closed", () => {
  const closedByUser = toggleBatch(toggleBatch(EMPTY_VIEW, t2, batches), t2, batches);
  assert.equal(isOpen(closedByUser, t2), false);
  const landing = { delegateId: id("failed") };
  const landed = landOn(closedByUser, landing, batches);
  assert.equal(isOpen(landed, t2), true);
  assert.equal(landed.expanded, "failed");
  assert.equal(landed.landed, landing);
});

test("toggles of batches that no longer exist are dropped on the next change", () => {
  const toggled = toggleBatch(toggleBatch(EMPTY_VIEW, t1, batches), t2, batches);
  assert.deepEqual([...toggled.toggled.keys()].toSorted(), ["t1", "t2"]);
  const rewritten = selectBatches(delegates.slice(1), turns.slice(1)); // a rewrite dropped t1 and its subagent
  assert.deepEqual([...toggleRow(toggled, id("latest"), rewritten).toggled.keys()], ["t2"]);
  assert.deepEqual([...landOn(toggled, { delegateId: id("latest") }, rewritten).toggled.keys()].toSorted(), ["t2", "t3"]);
});

function id(value: string): DelegateId {
  return value as DelegateId;
}

function prompt(turnId: string, at: number): Turn {
  return { id: turnId, startedAt: at, messages: [{ id: turnId, at, from: "user", text: turnId }] };
}

function delegate(name: string, startedAt: number, state: DelegateState): Delegate {
  return { id: id(name), origin: { kind: "delegation" }, providerId: "claude-code", turnId: null, title: name, startedAt, steps: [], scopes: [], usage: null, state };
}

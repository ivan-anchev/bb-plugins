import assert from "node:assert/strict";
import { test } from "node:test";
import type { Delegate, DelegateId, DelegateState } from "./delegate.ts";
import { census, selectRoster, span } from "./roster.ts";

test("selectRoster keeps the latest delegating turn plus anything still running, oldest first", () => {
  const delegates = [
    delegate("old-done", "t1", 100, { status: "completed", endedAt: 150, report: null }),
    delegate("old-running", "t1", 110, { status: "running" }),
    delegate("mid-failed", "t2", 200, { status: "failed", endedAt: 260, error: null }),
    delegate("new-b", "t3", 320, { status: "running" }),
    delegate("new-a", "t3", 300, { status: "completed", endedAt: 400, report: "ok" }),
  ];
  assert.deepEqual(selectRoster(delegates).map((d) => d.id), ["old-running", "new-a", "new-b"]);
});

test("selectRoster of no delegates is empty", () => {
  assert.deepEqual(selectRoster([]), []);
});

test("census counts in the fixed order running, done, failed, stopped and omits zeros", () => {
  const { total, parts } = census([
    delegate("s", "t", 1, { status: "stopped", endedAt: 2 }),
    delegate("c1", "t", 1, { status: "completed", endedAt: 2, report: null }),
    delegate("r", "t", 1, { status: "running" }),
    delegate("c2", "t", 1, { status: "completed", endedAt: 2, report: null }),
  ]);
  assert.equal(total, 4);
  assert.deepEqual(parts.map((p) => `${p.count} ${p.word}`), ["1 running", "2 done", "1 stopped"]);
});

test("span is wall-clock from the first start to now while any runs", () => {
  const delegates = [
    delegate("a", "t", 1_000, { status: "completed", endedAt: 5_000, report: null }),
    delegate("b", "t", 2_000, { status: "running" }),
  ];
  assert.equal(span(delegates, 9_000), 8_000);
});

test("span of settled delegates runs from the first start to the last end, not the sum of runs", () => {
  const delegates = [
    delegate("a", "t", 1_000, { status: "completed", endedAt: 4_000, report: null }), // ran 3 s
    delegate("b", "t", 2_000, { status: "failed", endedAt: 6_000, error: null }), // ran 4 s, overlapping
  ];
  assert.equal(span(delegates, 99_000), 5_000);
});

function delegate(id: string, turnId: string, startedAt: number, state: DelegateState): Delegate {
  return { id: id as DelegateId, turnId, title: id, startedAt, steps: [], usage: null, state };
}

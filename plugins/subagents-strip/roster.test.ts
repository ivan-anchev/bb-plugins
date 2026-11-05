import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { EventRow, TimelineRow } from "./bb.ts";
import type { Delegate, DelegateId, DelegateState } from "./delegate.ts";
import { foldTaskEvents, normalise } from "./normalise.ts";
import { census, detailLine, elapsed, selectRoster, span } from "./roster.ts";

// Real delegates from the fixture (see normalise.test.ts for how it was taken).
const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);
const real = normalise(fixture.rows, foldTaskEvents(new Map(), fixture.events));

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

test("a running row's detail is its latest step's label, skipping reasoning", () => {
  const d = realById("dafb9611c6-i5"); // its steps end: reasoning, command, reasoning
  assert.equal(d.steps?.at(-1)?.kind, "system");
  assert.match(detailLine({ ...d, state: { status: "running" } }), /^Ran D=\/Users\/ivananchev\/\.bb\/thread-storage\//);
});

test("a running row with no steps yet reads Starting…", () => {
  assert.equal(detailLine(delegate("r", "t", 1, { status: "running" })), "Starting…");
});

test("a settled row's detail is its outcome: the report's or error's first line, else a fixed word", () => {
  assert.equal(detailLine(realById("dafb9611c6-i4")), "t3code subagent visuals: findings"); // report opens "# t3code subagent visuals: findings"
  assert.equal(detailLine(delegate("c", "t", 1, { status: "completed", endedAt: 2, report: null })), "Finished without a report");
  assert.equal(detailLine(delegate("f", "t", 1, { status: "failed", endedAt: 2, error: "git clone exited with 128\nfatal: TLS" })), "git clone exited with 128");
  assert.equal(detailLine(delegate("f", "t", 1, { status: "failed", endedAt: 2, error: null })), "Failed");
  assert.equal(detailLine(delegate("s", "t", 1, { status: "stopped", endedAt: 2 })), "Stopped");
});

test("elapsed runs to now while running and to the end once settled", () => {
  assert.equal(elapsed(delegate("r", "t", 1_000, { status: "running" }), 7_500), 6_500);
  assert.equal(elapsed(delegate("c", "t", 1_000, { status: "completed", endedAt: 4_000, report: null }), 99_000), 3_000);
});

function realById(id: string): Delegate {
  const d = real.find((x) => x.id === id);
  assert.ok(d, `no fixture delegate ${id}`);
  return d;
}

function delegate(id: string, turnId: string, startedAt: number, state: DelegateState): Delegate {
  return { id: id as DelegateId, turnId, title: id, startedAt, steps: [], usage: null, state };
}

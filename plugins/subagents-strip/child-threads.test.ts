// Child threads as delegates, on real captures (fixtures/child-threads.json):
//   parent        thr_24dxq5xhph's top-level rows (GET /api/v1/threads/<id>/timeline?segmentLimit=20),
//                 each delegation's child rows cut to its first and last two
//   parentRunning thr_bz3t99e3qp (throwaway Claude Code parent, issue 06b) read the same way mid-turn,
//                 as the source reads it (includeNestedRows=true): the running turn's rows are flat
//   children      its two oldest children as `bb thread list --parent-thread thr_24dxq5xhph --json` lists them
//   reviewerRows  thr_2sspz65bvd (Codex reviewer, settled), read as the source reads a child:
//                 GET /api/v1/threads/<id>/timeline?segmentLimit=20&includeNestedRows=true
//   counter       thr_ys49uh7mzb (Codex child of a throwaway Claude Code thread, issue 06b) running
//                 its first `sleep`, then settled; its list row at each read
// Every string is cut to 200 characters except a closing assistant message.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ChildThread, TimelineRow } from "./bb.ts";
import { childDelegate, childrenInView, threadRunning } from "./child-threads.ts";
import { detailLine, metaParts } from "./roster.ts";

type Read = { child: ChildThread; rows: TimelineRow[] };
const fixture: {
  parent: { rows: TimelineRow[] };
  parentRunning: { rows: TimelineRow[] };
  children: ChildThread[];
  reviewerRows: TimelineRow[];
  counter: { running: Read; settled: Read };
} = JSON.parse(readFileSync(new URL("./fixtures/child-threads.json", import.meta.url), "utf8"));
const parentRows = fixture.parent.rows;
const { running, settled } = fixture.counter;

test("a child belongs to the parent turn under way when it was created", () => {
  const designer = childById("thr_hyxefjhk94");
  // Live: this Codex child landed in the turn of the Claude delegation "Designer 06-A".
  assert.equal(childDelegate(designer, [], parentRows).turnId, "da0b57f386-t1");
});

test("a child spawned in a running parent turn belongs to it, though that turn has no turn row yet", () => {
  const rows = fixture.parentRunning.rows;
  const command = rows.at(-1);
  assert.ok(command?.kind === "work" && command.status === "pending", "fixture premise: the turn's last command is running");
  assert.ok(!rows.some((row) => row.kind === "turn" && row.turnId === command.turnId), "fixture premise: no turn row for it");
  // hand-built: the counter's list row, created just after that command started, as `bb thread spawn` would.
  const spawned = { ...settled.child, createdAt: command.startedAt + 100 };
  assert.equal(childDelegate(spawned, [], rows).turnId, "da2752d426-t5");
});

test("a settled child spawned before the loaded parent rows is out of view; a running one stays in", () => {
  const reviewer = childById("thr_2sspz65bvd");
  assert.ok(reviewer.createdAt < Math.min(...parentRows.map((row) => row.startedAt)), "fixture premise");
  assert.deepEqual(childrenInView(fixture.children, parentRows).map((child) => child.id), ["thr_hyxefjhk94"]);
  assert.equal(childDelegate(reviewer, [], parentRows).turnId, null);
  const stillRunning = { ...reviewer, status: "active" as const };
  assert.deepEqual(childrenInView([stillRunning], parentRows), [stillRunning]);
});

test("an idle child whose turn completed reports its closing message, which leaves its steps", () => {
  const reviewer = childById("thr_2sspz65bvd");
  const closing = fixture.reviewerRows.at(-1);
  assert.ok(closing?.kind === "conversation" && closing.role === "assistant", "fixture premise: the rows end in the closing message");
  const d = childDelegate(reviewer, fixture.reviewerRows, parentRows);
  // `bb thread output thr_2sspz65bvd` prints the same text.
  assert.deepEqual(d.state, { status: "completed", endedAt: reviewer.updatedAt, report: closing.text });
  assert.match(detailLine(d), /^VERDICT: APPROVE$/);
  assert.ok(!d.steps?.some((row) => row.id === closing.id));
  assert.equal(d.steps?.length, 13, "the settled turn's rows, read nested");
  assert.deepEqual(d.origin, { kind: "child-thread", threadId: "thr_2sspz65bvd" });
  assert.equal(d.providerId, "codex");
  assert.equal(d.title, "reviewer 05 r1 (gpt-6.1-sol)");
  assert.equal(d.usage, null);
});

test("a running child is running, its detail its latest command, and its brief is not a step", () => {
  const d = childDelegate(running.child, running.rows, parentRows);
  assert.deepEqual(d.state, { status: "running" });
  assert.equal(detailLine(d), "Ran sleep 40 && echo one");
  assert.ok(!d.steps?.some((row) => row.kind === "conversation" && row.role === "user"));
  assert.ok(running.rows.some((row) => row.kind === "conversation" && row.role === "user"), "fixture premise: the brief is a row");
});

test("a settled child ends at its turn's completedAt, and its meta line counts steps but no usage", () => {
  const d = childDelegate(settled.child, settled.rows, parentRows);
  assert.equal(d.state.status === "completed" && d.state.endedAt, settled.child.updatedAt);
  assert.equal(d.state.status === "completed" && d.state.report, "Counted: one, two. Both commands ran; nothing was edited.");
  assert.deepEqual(metaParts(d).slice(1), ["ran 1m 32s", "3 steps"]);
});

test("an idle child ends the way its last turn did; an errored thread fails with bb's last error", () => {
  const withTurn = (status: Extract<TimelineRow, { kind: "turn" }>["status"]) =>
    settled.rows.map((row) => (row.kind === "turn" ? { ...row, status } : row));
  const statusOf = (child: ChildThread, rows: readonly TimelineRow[]) => childDelegate(child, rows, parentRows).state.status;
  assert.equal(statusOf(settled.child, withTurn("completed")), "completed");
  assert.equal(statusOf(settled.child, withTurn("error")), "failed");
  assert.equal(statusOf(settled.child, withTurn("interrupted")), "stopped");
  assert.equal(statusOf(settled.child, withTurn("pending")), "stopped");
  assert.equal(statusOf(settled.child, settled.rows.filter((row) => row.kind !== "turn")), "completed");
  for (const status of ["pending", "starting", "active", "stopping"] as const) {
    assert.equal(statusOf({ ...settled.child, status }, settled.rows), "running", status);
  }
  const error: TimelineRow = {
    id: "err1", threadId: settled.child.id, turnId: null, sourceSeqStart: 60, sourceSeqEnd: 60,
    startedAt: 1793898234000, createdAt: 1793898234000, kind: "system", systemKind: "error",
    status: null, title: "Provider exited", detail: null,
  };
  const failed = childDelegate({ ...settled.child, status: "error" }, [...settled.rows, error], parentRows);
  assert.deepEqual(failed.state, { status: "failed", endedAt: settled.child.updatedAt, error: "Provider exited" });
});

test("a thread status newer than the pinned SDK reads as running and never throws", () => {
  // why: JSON.parse types it as the SDK's status without a cast, as a newer bb host would send it.
  const status: ChildThread["status"] = JSON.parse('"hibernating"');
  const child = { ...settled.child, status };
  assert.equal(threadRunning(child), true);
  assert.deepEqual(childDelegate(child, settled.rows, parentRows).state, { status: "running" });
});

function childById(id: string): ChildThread {
  const child = fixture.children.find((c) => c.id === id);
  assert.ok(child, `no fixture child ${id}`);
  return child;
}

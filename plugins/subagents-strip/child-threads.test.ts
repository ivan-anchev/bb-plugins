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
//   outcomes      children of thr_zx2w4sat7z (throwaway Claude Code parent, issue 06c), each list row as
//                 `bb thread show <id> --json` gave it and its rows read as the source reads a child;
//                 parentRows is that parent's rows read the same way
//     stopped       thr_8d4ytj895v (Codex) after `bb thread stop` mid `sleep 300`
//     resumed       the same child after `bb thread send` "Reply with exactly: resumed." and its reply
//     failedTurn    thr_uixigbd79i (Claude Code, `--model claude-nonexistent-06c`): the provider rejected the turn
//     failedProvisioning thr_79zb76x32u (Codex, `--base-branch no-such-branch-06c`): no worktree, no turn
//     waiting       thr_c7hytt7tdq (Claude Code) blocked on its own AskUserQuestion
//     reused        thr_tfst24jjhy (Codex) settled, then running and settled again after a `bb thread send`
// Every string is cut to 200 characters except an assistant message.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ChildThread, TimelineRow } from "./bb.ts";
import { childDelegate, childrenInView, threadRunning } from "./child-threads.ts";
import { detailLine } from "./detail-line.ts";
import { metaParts } from "./roster.ts";

type Read = { child: ChildThread; rows: TimelineRow[] };
const fixture: {
  parent: { rows: TimelineRow[] };
  parentRunning: { rows: TimelineRow[] };
  children: ChildThread[];
  reviewerRows: TimelineRow[];
  counter: { running: Read; settled: Read };
  outcomes: {
    parentRows: TimelineRow[];
    stopped: Read;
    resumed: Read;
    failedTurn: Read;
    failedProvisioning: Read;
    waiting: Read;
    reused: { settled: Read; running: Read; settledAgain: Read };
  };
} = JSON.parse(readFileSync(new URL("./fixtures/child-threads.json", import.meta.url), "utf8"));
const parentRows = fixture.parent.rows;
const { running, settled } = fixture.counter;
const { outcomes } = fixture;

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

test("a running child is running, its detail its latest line in bb's words, and its brief is not a step", () => {
  const d = childDelegate(running.child, running.rows, parentRows);
  assert.deepEqual(d.state, { status: "running" });
  assert.equal(detailLine(d), "Running 1 command"); // the trail's live line, never the raw command
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

test("a stopped child reads stopped at its stop, though bb leaves its interrupted turn no turn row", () => {
  const { child, rows } = outcomes.stopped;
  assert.equal(child.status, "idle", "fixture premise: a stopped thread is idle");
  assert.ok(!rows.some((row) => row.kind === "turn"), "fixture premise: no turn row");
  const stop = rows.at(-1);
  assert.ok(stop?.kind === "system" && stop.systemKind === "operation" && stop.operationKind === "thread-interrupted");
  const d = childDelegate(child, rows, outcomes.parentRows);
  assert.deepEqual(d.state, { status: "stopped", endedAt: stop.completedAt });
  assert.equal(detailLine(d), "Stopped");
  assert.deepEqual(metaParts(d).slice(1), ["ran 1m 08s", "4 steps"]);
});

test("a stopped child told something since ends the way that newer turn did, not stopped", () => {
  const { child, rows } = outcomes.resumed;
  assert.ok(rows.some((row) => row.kind === "system" && row.status === "interrupted"), "fixture premise: the stop row is still there");
  assert.ok(!rows.some((row) => row.kind === "turn"), "fixture premise: the reply-only turn has no turn row");
  const d = childDelegate(child, rows, outcomes.parentRows);
  assert.deepEqual(d.state, { status: "completed", endedAt: child.updatedAt, report: "resumed." });
});

test("a child whose provider rejected its turn fails with bb's error row, at the turn's end", () => {
  const { child, rows } = outcomes.failedTurn;
  const turn = rows.find((row) => row.kind === "turn");
  assert.ok(turn?.kind === "turn" && turn.status === "error", "fixture premise: an errored turn row");
  const d = childDelegate(child, rows, outcomes.parentRows);
  assert.deepEqual(d.state, { status: "failed", endedAt: turn.completedAt, error: "Provider rejected request" });
  assert.equal(detailLine(d), "Provider rejected request");
});

test("a child whose workspace could not be provisioned fails with that step's title, at its updatedAt", () => {
  const { child, rows } = outcomes.failedProvisioning;
  assert.ok(!rows.some((row) => row.kind === "turn" || (row.kind === "system" && row.systemKind === "error")), "fixture premise");
  const d = childDelegate(child, rows, outcomes.parentRows);
  assert.deepEqual(d.state, { status: "failed", endedAt: child.updatedAt, error: "Provisioning thread failed" });
});

test("a child waiting on its own question is active, so it reads running, its detail the question", () => {
  const { child, rows } = outcomes.waiting;
  assert.equal(child.status, "active", "fixture premise: bb keeps a child blocked on a question active");
  const d = childDelegate(child, rows, outcomes.parentRows);
  assert.deepEqual(d.state, { status: "running" });
  assert.equal(detailLine(d), "Asking a question");
});

test("a reused child stays one delegate of its spawning turn: running again, then settled with its new closing message", () => {
  const { settled: first, running: again, settledAgain: last } = outcomes.reused;
  const [d1, d2, d3] = [first, again, last].map(({ child, rows }) => childDelegate(child, rows, outcomes.parentRows));
  assert.deepEqual([d1, d2, d3].map((d) => [d.id, d.turnId, d.startedAt]), Array(3).fill(["thr_tfst24jjhy", "daebae5ddb-t2", first.child.createdAt]));
  assert.equal(d1.state.status === "completed" && d1.state.report, "first done.");
  assert.deepEqual(d2.state, { status: "running" });
  assert.equal(detailLine(d2), "Running 1 command");
  const lastTurn = last.rows.findLast((row) => row.kind === "turn");
  assert.ok(lastTurn?.kind === "turn");
  assert.deepEqual(d3.state, { status: "completed", endedAt: lastTurn.completedAt, report: "third done." });
  assert.equal(metaParts(d3)[1], "ran 4m 12s");
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

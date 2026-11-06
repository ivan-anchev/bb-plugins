// The quirk step, tested through its surface (foldTaskEvents + normalise) on a
// trimmed real capture of thread thr_gza9vveeei (Claude Code 2.1, 8 background
// agents, one of them resumed after its handback, one with a nested agent):
//   GET /api/v1/threads/thr_gza9vveeei/timeline?includeNestedRows=true&segmentLimit=20
//   GET /api/v1/threads/thr_gza9vveeei/events?types=item/started,item/backgroundTask/progress,item/backgroundTask/completed
// Trimmed to: turn rows holding only their delegation rows; each delegate's first
// and last 8 child rows plus any nested delegation; strings cut to 200 characters
// except the handback message; events whose item is a delegation or background task.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DelegationRow, EventRow, TimelineRow } from "./bb.ts";
import type { Delegate } from "./delegate.ts";
import { formatDuration } from "./clock.ts";
import { foldTaskEvents, normalise } from "./normalise.ts";
import { detailLine, elapsed } from "./roster.ts";
import { childSteps, trailSteps, transcriptSteps } from "./steps.ts";

const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);
const delegationRows = fixture.rows.flatMap((row) => (row.kind === "turn" ? (row.children ?? []) : [])).filter(isDelegationRow);
const delegates = normalise(fixture.rows, foldTaskEvents(new Map(), fixture.events), "claude-code");

test("fixture premise: every row says completed and carries the launch receipt as output", () => {
  assert.equal(delegationRows.length, 8);
  for (const row of delegationRows) {
    assert.equal(row.status, "completed");
    assert.match(row.output, /^Async agent launched/);
  }
});

test("at every point in the event stream, each delegate's status follows its latest task event", () => {
  for (const cut of fixture.events) {
    const seen = fixture.events.filter((event) => event.seq <= cut.seq);
    for (const d of normalise(fixture.rows, foldTaskEvents(new Map(), seen), "claude-code")) {
      const latest = taskEventsFor(seen, d.id).at(-1);
      const expected = latest === undefined ? "completed" : latest.taskStatus === "completed" ? "completed" : "running";
      assert.equal(d.state.status, expected, `${d.title} after seq ${cut.seq}`);
    }
  }
});

test("a task with only item/started is running, though its row says completed", () => {
  const started = fixture.events.find((e) => e.type === "item/started" && taskOf(e)?.parentToolCallId === "dafb9611c6-i4");
  assert.ok(started);
  const d = byId(normalise(fixture.rows, foldTaskEvents(new Map(), [started]), "claude-code"), "dafb9611c6-i4");
  assert.equal(rowById("dafb9611c6-i4").status, "completed");
  assert.equal(d.state.status, "running");
});

test("completed delegates carry the last handback message as the report, never the launch receipt", () => {
  for (const d of delegates) {
    assert.equal(d.state.status, "completed");
    if (d.state.status !== "completed") continue;
    assert.equal(d.state.report, lastHandbackMessage(rowById(d.id)), d.title);
    assert.doesNotMatch(d.state.report ?? "", /^Async agent launched/);
  }
});

test("a resumed agent whose handback is followed by more rows still reports that handback", () => {
  const row = rowById("da3b7c4ca3-i4");
  assert.notEqual(row.childRows?.at(-1)?.kind, "work"); // a message follows the handback
  const d = byId(delegates, "da3b7c4ca3-i4");
  assert.match(d.state.status === "completed" ? (d.state.report ?? "") : "", /^Research \(map mode\)/);
});

test("usage is non-null exactly for delegates with task events", () => {
  for (const d of delegates) {
    const lastUsage = taskEventsFor(fixture.events, d.id).findLast((task) => task.usage)?.usage;
    assert.ok(lastUsage, `fixture premise: ${d.title} has task events with usage`);
    assert.deepEqual(d.usage, lastUsage);
  }
  for (const d of normalise(fixture.rows, new Map(), "claude-code")) assert.equal(d.usage, null);
});

// why: bb's chat counts a nested delegation ("ran 1 subagent") and the handback ("ran 1 tool") in
// its work groups, so both stay steps; the strip shows the handback only as the outcome.
test("a nested delegation is a step of its delegate, never a delegate of its own", () => {
  assert.equal(delegates.length, 8);
  assert.ok(!delegates.some((d) => d.id === "dafebd499d-i19"));
  const nested = rowById("dafebd499d-i3").childRows?.find((row) => row.kind === "work" && row.workKind === "delegation");
  assert.ok(nested, "fixture premise: dafebd499d-i3 runs a nested agent");
  assert.ok(trailSteps(byId(delegates, "dafebd499d-i3").steps ?? []).includes(nested));
});

test("steps keep reasoning and the handback; the transcript drops the handback, the trail both", () => {
  const steps = delegates.flatMap((d) => d.steps ?? []);
  assert.ok(steps.some(isReasoning));
  assert.ok(steps.some(isHandbackRow));
  const transcript = delegates.flatMap((d) => transcriptSteps(d.steps ?? []));
  assert.ok(transcript.some(isReasoning));
  assert.ok(!transcript.some(isHandbackRow));
  const trail = delegates.flatMap((d) => trailSteps(d.steps ?? []));
  assert.ok(trail.length > 0);
  assert.ok(!trail.some(isReasoning) && !trail.some(isHandbackRow));
});

test("Claude Code delegates keep their description as the title and every transcript step", () => {
  for (const d of delegates) {
    const row = rowById(d.id);
    assert.equal(d.title, row.description);
    assert.deepEqual(d.steps, childSteps(row.childRows ?? []), d.title);
  }
});

test("Codex (hand-built): several collab rows on one childRef make one delegate", () => {
  const rows = [
    handBuilt({ callId: "c1", childRef: "agent-A", status: "completed", output: "spawned", startedAt: 1 }),
    handBuilt({ callId: "c2", childRef: "agent-A", status: "completed", output: "waited", startedAt: 2 }),
    handBuilt({ callId: "c3", childRef: "agent-A", status: "pending", output: "", startedAt: 3 }),
  ];
  const [d, ...rest] = normalise(rows, new Map(), "codex");
  assert.equal(rest.length, 0);
  assert.equal(d.id, "c1");
  assert.equal(d.startedAt, 1);
  assert.equal(d.state.status, "running"); // the last row decides
});

test("ACP (hand-built): a row with childRows null yields steps null and its output as the report", () => {
  const [d] = normalise([handBuilt({ callId: "a1", childRef: null, status: "completed", output: "All done.", childRows: null })], new Map(), "claude-code");
  assert.equal(d.steps, null);
  assert.deepEqual(d.state, { status: "completed", endedAt: 50, report: "All done." });
});

test("a row with no task maps by its own status", () => {
  const [failed] = normalise([handBuilt({ callId: "e1", status: "error", output: "boom" })], new Map(), "claude-code");
  assert.deepEqual(failed.state, { status: "failed", endedAt: 50, error: "boom" });
  // hand-built: no interrupted row could be produced (see the stopped capture below); bb writes this output when it interrupts a pending call.
  const [stopped] = normalise([handBuilt({ callId: "i1", status: "interrupted", output: "Tool execution interrupted" })], new Map(), "claude-code");
  assert.deepEqual(stopped.state, { status: "stopped", endedAt: 50 });
});

// ---------------------------------------------------------------- stopped and failed, real

// A second trimmed real capture, thread thr_b2fe5q9v9i (Claude Code 2.1, issue 05),
// taken and trimmed as above, one delegate per turn:
//   turn 1  "Count slowly to ninety": background agent; the parent thread was stopped (`bb thread stop`) 32 s in.
//   turn 2  "Use a missing agent type": an Agent call with an unknown subagent_type, refused at launch.
//   turn 3  "Count until killed": background agent the parent stopped with its TaskStop tool.
const stopFailed: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-stopped-failed.json", import.meta.url), "utf8"),
);
const stopFailedLedger = foldTaskEvents(new Map(), stopFailed.events);

test("a background agent whose parent thread is stopped reads stopped, ended and frozen at the stop", () => {
  const stop = eventAt(stopFailed.events, 42);
  assert.equal(taskOf(stop)?.taskStatus, "stopped"); // bb closes the task when it interrupts the turn
  const d = byId(normalise(stopFailed.rows, stopFailedLedger, "claude-code"), "daee87293d-i1");
  assert.deepEqual(d.state, { status: "stopped", endedAt: stop.createdAt });
  assert.equal(elapsed(d, stop.createdAt + 60_000), elapsed(d, stop.createdAt)); // the clock stops
  assert.equal(formatDuration(elapsed(d, Date.now())), "31s"); // 31.996 s from launch to stop
});

test("a background agent stopped with TaskStop reads stopped from its killed progress on", () => {
  assert.equal(taskOf(eventAt(stopFailed.events, 103))?.taskStatus, "killed");
  const seen = (seq: number) => stopFailed.events.filter((event) => event.seq <= seq);
  for (const seq of [103, 104]) {
    const d = byId(normalise(stopFailed.rows, foldTaskEvents(new Map(), seen(seq)), "claude-code"), "da77a0df0c-i8");
    assert.deepEqual(d.state, { status: "stopped", endedAt: eventAt(stopFailed.events, seq).createdAt }, `after seq ${seq}`);
  }
});

test("an Agent call refused at launch fails with the row's error, over its real sub-second run", () => {
  const row = stopFailed.rows.flatMap((r) => (r.kind === "turn" ? (r.children ?? []) : [])).filter(isDelegationRow)
    .find((r) => r.callId === "da77a0df0c-i2");
  assert.ok(row?.completedAt, "fixture premise: the refused row carries its completedAt");
  assert.equal(row.status, "error");
  assert.ok(!stopFailedLedger.has(row.callId), "fixture premise: no task started");
  const d = byId(normalise(stopFailed.rows, stopFailedLedger, "claude-code"), row.callId);
  assert.deepEqual(d.state, { status: "failed", endedAt: row.completedAt, error: row.output });
  assert.match(row.output, /^Agent type 'no-such-agent-type' not found/);
  assert.ok(elapsed(d, Date.now()) < 1_000); // so its "0s" is the truth
});

test("a failed task (hand-built) takes its error from the task event, never the row's launch receipt", () => {
  // why: no agent task has failed on this machine; this is the turn 1 agent's real closing event, refiled as failed.
  const stop = eventAt(stopFailed.events, 42);
  assert.ok(stop.type === "item/backgroundTask/completed");
  const stateIfFailedWith = (error: string) => {
    const failed: EventRow = { ...stop, data: { ...stop.data, item: { ...stop.data.item, taskStatus: "failed", error } } };
    const ledger = foldTaskEvents(new Map(), [...stopFailed.events.filter((e) => e.seq < stop.seq), failed]);
    return byId(normalise(stopFailed.rows, ledger, "claude-code"), "daee87293d-i1").state;
  };
  assert.deepEqual(stateIfFailedWith("API Error: 529 overloaded"), { status: "failed", endedAt: stop.createdAt, error: "API Error: 529 overloaded" });
  assert.deepEqual(stateIfFailedWith(""), { status: "failed", endedAt: stop.createdAt, error: null });
});

// ---------------------------------------------------------------- Codex, real

// A third trimmed real capture, thread thr_6thqrgar7v (Codex, native multi-agent:
// each of 3 turns spawns two counters that count with `sleep` and then reply),
// read as above once during turn 1 (`midrun`: both counters running, their rows
// not yet in a turn) and once after turn 3 (`final`: 6 settled counters).
// Trimmed to: turn rows holding only their delegation rows; every child row kept.
// Codex sends no background-task events, so the ledger is empty.
const codex: { final: TimelineRow[]; midrun: TimelineRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/codex-thread.json", import.meta.url), "utf8"),
);
const codexSettled = normalise(codex.final, new Map(), "codex");
const codexRunning = normalise(codex.midrun, new Map(), "codex");

test("Codex fixture premise: settled rows carry no handback and no output, and end in an assistant message", () => {
  const rows = codex.final.flatMap((row) => (row.kind === "turn" ? (row.children ?? []) : [])).filter(isDelegationRow);
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(row.status, "completed");
    assert.equal(row.output, "");
    assert.equal(closingMessage(row).role, "assistant");
    assert.ok(!row.childRows?.some((child) => child.kind === "work" && child.workKind === "tool"));
  }
});

test("a Codex delegate reads as its agent name, not its path", () => {
  assert.deepEqual(codexSettled.map((d) => d.title), ["counter_a", "counter_b", "counter_c", "counter_d", "counter_e", "counter_f"]);
  assert.deepEqual(codexRunning.map((d) => d.title), ["counter_a", "counter_b"]);
});

test("a title that is not a whitespace-free absolute path is kept whole", () => {
  const titles = ["Research the SDK", "/root/a b", "/root/", "root/counter_a"].map(
    (description, i) => normalise([handBuilt({ callId: `t${i}`, status: "pending", output: "", description })], new Map(), "codex")[0].title,
  );
  assert.deepEqual(titles, ["Research the SDK", "/root/a b", "/root/", "root/counter_a"]);
  assert.equal(normalise([handBuilt({ callId: "t9", status: "pending", output: "", description: "/root/team/counter_g" })], new Map(), "codex")[0].title, "counter_g");
});

test("a settled Codex delegate reports its closing message, which leaves its steps", () => {
  for (const d of codexSettled) {
    const row = codexRowById(d.id);
    const closing = closingMessage(row);
    assert.deepEqual(d.state, { status: "completed", endedAt: row.completedAt, report: closing.text }, d.title);
    assert.ok(!d.steps?.some((step) => step.id === closing.id), d.title);
    // why: every counter says its last number just before its closing message, so that number is now the last step.
    assert.equal(trailSteps(d.steps ?? []).at(-1), row.childRows?.at(-2), d.title);
  }
  assert.equal(detailLine(byId(codexSettled, "da2bb99053-i60")), "counter_e said: 1, 2, 3, 4, 5, 6. Ran sleep 5 between numbers, five times total. No files edited.");
});

test("a running Codex delegate keeps its last message as its live step and has no report", () => {
  const [a, b] = codexRunning;
  for (const d of codexRunning) {
    assert.deepEqual(d.state, { status: "running" }, d.title);
    assert.deepEqual(d.steps, childSteps(codexRowById(d.id, codex.midrun).childRows ?? []), d.title);
  }
  assert.equal(detailLine(a), "Ran sleep 3");
  assert.equal(detailLine(b), "4");
});

test("a completed row's own output outranks its last message", () => {
  const row = { ...codexRowById("da2bb99053-i63"), output: "Counted to six." };
  const [d] = normalise([row], new Map(), "codex");
  assert.deepEqual(d.state, { status: "completed", endedAt: row.completedAt, report: "Counted to six." });
  assert.deepEqual(d.steps, childSteps(row.childRows ?? []));
});

test("every delegation-row delegate carries the delegation origin and the thread's provider", () => {
  const claude = [...delegates, ...normalise(stopFailed.rows, stopFailedLedger, "claude-code")];
  for (const d of claude) assert.deepEqual([d.origin, d.providerId], [{ kind: "delegation" }, "claude-code"], d.title);
  for (const d of [...codexSettled, ...codexRunning]) assert.deepEqual([d.origin, d.providerId], [{ kind: "delegation" }, "codex"], d.title);
  assert.equal(claude.length + codexSettled.length + codexRunning.length, 19);
});

// ---------------------------------------------------------------- helpers

function codexRowById(callId: string, rows: readonly TimelineRow[] = codex.final): DelegationRow {
  const row = rows.flatMap((r) => (r.kind === "turn" ? (r.children ?? []) : [r])).filter(isDelegationRow).find((r) => r.callId === callId);
  assert.ok(row, `no Codex fixture row ${callId}`);
  return row;
}

function closingMessage(row: DelegationRow): Extract<TimelineRow, { kind: "conversation" }> {
  const last = row.childRows?.at(-1);
  assert.ok(last?.kind === "conversation", `fixture premise: ${row.callId} ends in a message`);
  return last;
}

function isDelegationRow(row: TimelineRow): row is DelegationRow {
  return row.kind === "work" && row.workKind === "delegation";
}

function isHandbackRow(row: TimelineRow): boolean {
  return row.kind === "work" && row.workKind === "tool" && row.toolName === "SubagentHandback";
}

function isReasoning(row: TimelineRow): boolean {
  return row.kind === "system" && row.systemKind === "operation" && row.operationKind === "reasoning";
}

function rowById(callId: string): DelegationRow {
  const row = delegationRows.find((r) => r.callId === callId);
  assert.ok(row, `no fixture row ${callId}`);
  return row;
}

function byId(list: readonly Delegate[], id: string): Delegate {
  const d = list.find((x) => x.id === id);
  assert.ok(d, `no delegate ${id}`);
  return d;
}

function eventAt(events: readonly EventRow[], seq: number): EventRow {
  const event = events.find((e) => e.seq === seq);
  assert.ok(event, `no fixture event ${seq}`);
  return event;
}

function taskOf(event: EventRow) {
  if (event.type === "item/started") return event.data.item.type === "backgroundTask" ? event.data.item : null;
  if (event.type === "item/backgroundTask/progress" || event.type === "item/backgroundTask/completed") return event.data.item;
  return null;
}

function taskEventsFor(events: readonly EventRow[], callId: string) {
  return events.flatMap((event) => {
    const task = taskOf(event);
    return task?.parentToolCallId === callId ? [task] : [];
  });
}

function lastHandbackMessage(row: DelegationRow): unknown {
  const handback = row.childRows?.findLast((c) => c.kind === "work" && c.workKind === "tool" && c.toolName === "SubagentHandback");
  assert.ok(handback?.kind === "work" && handback.workKind === "tool", `fixture premise: ${row.callId} has a handback`);
  return handback.toolArgs?.message;
}

/** A delegation row shaped like a real one, for providers with no sample on this machine. */
function handBuilt(fields: Partial<DelegationRow> & Pick<DelegationRow, "callId" | "status" | "output">): DelegationRow {
  return {
    ...delegationRows[0],
    childRef: fields.callId,
    childRows: [],
    background: false,
    startedAt: 10,
    completedAt: 50,
    turnId: "t1",
    ...fields,
  };
}

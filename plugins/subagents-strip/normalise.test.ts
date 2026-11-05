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
import { foldTaskEvents, normalise } from "./normalise.ts";
import { trailSteps } from "./steps.ts";

const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);
const delegationRows = fixture.rows.flatMap((row) => (row.kind === "turn" ? (row.children ?? []) : [])).filter(isDelegationRow);
const delegates = normalise(fixture.rows, foldTaskEvents(new Map(), fixture.events));

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
    for (const d of normalise(fixture.rows, foldTaskEvents(new Map(), seen))) {
      const latest = taskEventsFor(seen, d.id).at(-1);
      const expected = latest === undefined ? "completed" : latest.taskStatus === "completed" ? "completed" : "running";
      assert.equal(d.state.status, expected, `${d.title} after seq ${cut.seq}`);
    }
  }
});

test("a task with only item/started is running, though its row says completed", () => {
  const started = fixture.events.find((e) => e.type === "item/started" && taskOf(e)?.parentToolCallId === "dafb9611c6-i4");
  assert.ok(started);
  const d = byId(normalise(fixture.rows, foldTaskEvents(new Map(), [started])), "dafb9611c6-i4");
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
  for (const d of normalise(fixture.rows, new Map())) assert.equal(d.usage, null);
});

test("a nested delegation is neither a delegate nor a step", () => {
  assert.equal(delegates.length, 8);
  assert.ok(!delegates.some((d) => d.id === "dafebd499d-i19"));
  assert.ok(rowById("dafebd499d-i3").childRows?.some((row) => row.kind === "work" && row.workKind === "delegation"));
  for (const d of delegates) assert.ok(!(d.steps ?? []).some((row) => row.kind === "work" && row.workKind === "delegation"));
});

test("steps keep reasoning and drop the handback; the trail also drops reasoning", () => {
  const steps = delegates.flatMap((d) => d.steps ?? []);
  assert.ok(steps.some(isReasoning));
  assert.ok(!steps.some((row) => row.kind === "work" && row.workKind === "tool" && row.toolName === "SubagentHandback"));
  const trail = delegates.flatMap((d) => trailSteps(d.steps ?? []));
  assert.ok(trail.length > 0);
  assert.ok(!trail.some(isReasoning));
});

test("Codex (hand-built): several collab rows on one childRef make one delegate", () => {
  const rows = [
    handBuilt({ callId: "c1", childRef: "agent-A", status: "completed", output: "spawned", startedAt: 1 }),
    handBuilt({ callId: "c2", childRef: "agent-A", status: "completed", output: "waited", startedAt: 2 }),
    handBuilt({ callId: "c3", childRef: "agent-A", status: "pending", output: "", startedAt: 3 }),
  ];
  const [d, ...rest] = normalise(rows, new Map());
  assert.equal(rest.length, 0);
  assert.equal(d.id, "c1");
  assert.equal(d.startedAt, 1);
  assert.equal(d.state.status, "running"); // the last row decides
});

test("ACP (hand-built): a row with childRows null yields steps null and its output as the report", () => {
  const [d] = normalise([handBuilt({ callId: "a1", childRef: null, status: "completed", output: "All done.", childRows: null })], new Map());
  assert.equal(d.steps, null);
  assert.deepEqual(d.state, { status: "completed", endedAt: 50, report: "All done." });
});

test("a row with no task maps by its own status", () => {
  const [failed] = normalise([handBuilt({ callId: "e1", status: "error", output: "boom" })], new Map());
  assert.deepEqual(failed.state, { status: "failed", endedAt: 50, error: "boom" });
  const [stopped] = normalise([handBuilt({ callId: "i1", status: "interrupted", output: "" })], new Map());
  assert.deepEqual(stopped.state, { status: "stopped", endedAt: 50 });
});

// ---------------------------------------------------------------- helpers

function isDelegationRow(row: TimelineRow): row is DelegationRow {
  return row.kind === "work" && row.workKind === "delegation";
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

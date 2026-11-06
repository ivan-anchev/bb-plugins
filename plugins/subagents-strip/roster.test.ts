import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { EventRow, TimelineRow } from "./bb.ts";
import type { Delegate, DelegateId, DelegateState, Turn, TurnMessage } from "./delegate.ts";
import { detailLine } from "./detail-line.ts";
import { foldTaskEvents, normalise } from "./normalise.ts";
import { batchCensus, census, elapsed, metaParts, selectBatches, selectRoster, span } from "./roster.ts";
import { trailItems } from "./work-groups.ts";

// Real delegates from the fixture (see normalise.test.ts for how it was taken).
const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);
const real = normalise(fixture.rows, foldTaskEvents(new Map(), fixture.events), "claude-code");

test("a batch is a user prompt and every delegate launched until the next one: other turns fold into it", () => {
  const turns = [
    prompt("t1", 90, "ok, fix the build"),
    turn("t2", 190, null), // Claude Code resuming when a background agent finishes
    turn("t3", 250, { from: "other", text: "reviewer 05 r1 completed" }), // a bb system notice
    prompt("t4", 290, "ship it"),
    prompt("t5", 300, "and the docs?"), // sent while t4 runs
    prompt("t6", 500, "thanks"), // launches nothing: no batch
  ];
  const delegates = [
    delegate("new-b", "t4", 320, { status: "completed", endedAt: 400, report: null }),
    delegate("old-done", "t1", 100, { status: "completed", endedAt: 150, report: null }),
    delegate("resumed", "t2", 200, { status: "failed", endedAt: 260, error: null }),
    delegate("notice", "t3", 260, { status: "completed", endedAt: 270, report: null }),
    delegate("new-a", "t4", 295, { status: "completed", endedAt: 400, report: "ok" }),
  ];
  const batches = oldestFirst(delegates, turns);
  // why: new-b is t4's, but launched at 320, after the user's next prompt at 300, so it is that prompt's.
  assert.deepEqual(batches.map((b) => [b.id, b.startedAt, b.label, b.delegates.map((d) => d.id)]), [
    ["t1", 90, "fix the build", ["old-done", "resumed", "notice"]],
    ["t4", 290, "ship it", ["new-a"]],
    ["t5", 300, "and the docs?", ["new-b"]],
  ]);
  assert.deepEqual(batches.map((b) => b.prompt), ["ok, fix the build", "ship it", "and the docs?"]);
});

test("a batch ends at the next user prompt even for a delegate of the turn before it: a queued prompt starts its own batch", () => {
  // The user queues "and the tests" at 200 while t1 runs; t1 launches one more subagent at 250; t2 starts at 260.
  const turns = [prompt("t1", 100, "fix the build"), prompt("t2", 200, "and the tests")];
  const batches = oldestFirst([
    delegate("first", "t1", 150, { status: "completed", endedAt: 160, report: null }),
    delegate("after-queue", "t1", 250, { status: "completed", endedAt: 270, report: null }),
  ], turns);
  assert.deepEqual(batches.map((b) => [b.label, b.delegates.map((d) => d.id)]), [
    ["fix the build", ["first"]],
    ["and the tests", ["after-queue"]],
  ]);
});

test("a prompt steered into a running turn starts its own batch from its own time", () => {
  // The user steers "and the tests" into t1 at 200; bb keeps one turn, t1, with both messages.
  const t1: Turn = { ...prompt("t1", 100, "fix the build"), messages: [said("t1", 100, "user", "fix the build"), said("t1-steer", 200, "user", "and the tests")] };
  const batches = oldestFirst([
    delegate("first", "t1", 150, { status: "completed", endedAt: 160, report: null }),
    delegate("after-steer", "t1", 250, { status: "completed", endedAt: 270, report: null }),
  ], [t1]);
  assert.deepEqual(batches.map((b) => [b.id, b.startedAt, b.label, b.delegates.map((d) => d.id)]), [
    ["t1", 100, "fix the build", ["first"]],
    ["t1-steer", 200, "and the tests", ["after-steer"]],
  ]);
});

test("delegates launched before any user prompt share one batch under the thread's first message", () => {
  const delegates = [
    delegate("early", "t1", 10, { status: "completed", endedAt: 20, report: null }),
    delegate("later", "t2", 110, { status: "completed", endedAt: 120, report: null }),
  ];
  const briefed = oldestFirst(delegates, [turn("t1", 5, { from: "other", text: "Build issue 10" }), prompt("t2", 100, "go")]);
  assert.deepEqual(briefed.map((b) => [b.id, b.startedAt, b.label, b.prompt]), [[null, 5, "Build issue 10", "Build issue 10"], ["t2", 100, "go", "go"]]);
  const silent = oldestFirst(delegates.slice(0, 1), [turn("t1", 5, null)]);
  assert.deepEqual(silent.map((b) => [b.id, b.startedAt, b.label, b.prompt]), [[null, 10, "Before the first prompt", null]]);
});

test("the tab lists batches newest first; the latest and any with a delegate still running open by default", () => {
  const turns = [prompt("t1", 0, "a"), prompt("t2", 100, "b"), turn("t3", 150, null), prompt("t4", 200, "c")];
  const batches = selectBatches([
    delegate("old-running", "t1", 10, { status: "running" }),
    delegate("old-failed", "t2", 110, { status: "failed", endedAt: 120, error: null }),
    delegate("resumed", "t3", 160, { status: "completed", endedAt: 170, report: null }),
    delegate("latest", "t4", 210, { status: "completed", endedAt: 220, report: null }),
  ], turns);
  assert.deepEqual(batches.map((b) => [b.id, b.opensByDefault]), [["t4", true], ["t2", false], ["t1", true]]);
});

test("a batch keeps its id and default when the history before it arrives: open state is keyed by prompt, not place", () => {
  const recent = [prompt("t8", 800, "go"), turn("t9", 900, null)];
  const older = [prompt("t1", 100, "first"), turn("t2", 200, null), prompt("t5", 500, "second")];
  const delegates = [
    delegate("a", "t2", 210, { status: "completed", endedAt: 220, report: null }),
    delegate("b", "t5", 510, { status: "completed", endedAt: 520, report: null }),
    delegate("c", "t9", 910, { status: "completed", endedAt: 920, report: null }),
  ];
  const before = oldestFirst(delegates.slice(2), recent);
  const after = oldestFirst(delegates, [...older, ...recent]);
  assert.deepEqual(before.map((b) => [b.id, b.opensByDefault]), [["t8", true]]);
  assert.deepEqual(after.map((b) => [b.id, b.opensByDefault]), [["t1", false], ["t5", false], ["t8", true]]);
});

test("a delegate whose turn is not among the turns read joins the last prompt before its start, as every delegate does", () => {
  const batches = oldestFirst([
    delegate("child", null, 150, { status: "running" }),
    delegate("known", "t1", 100, { status: "completed", endedAt: 150, report: null }),
    delegate("unknown-turn", "t9", 50, { status: "completed", endedAt: 60, report: null }),
  ], [prompt("t1", 90, "go")]);
  assert.deepEqual(batches.map((b) => [b.id, b.label, b.delegates.map((d) => d.id)]), [
    [null, "Before the first prompt", ["unknown-turn"]],
    ["t1", "go", ["known", "child"]],
  ]);
});

test("the strip shows the latest batch plus anything still running from an earlier one, oldest first", () => {
  const turns = [prompt("t1", 0, "a"), prompt("t2", 100, "b"), prompt("t3", 200, "c")];
  const roster = selectRoster([
    delegate("latest-b", "t3", 230, { status: "running" }),
    delegate("old-running", "t1", 10, { status: "running" }),
    delegate("old-done", "t1", 20, { status: "completed", endedAt: 30, report: null }),
    delegate("mid-failed", "t2", 110, { status: "failed", endedAt: 120, error: null }),
    delegate("latest-a", "t3", 210, { status: "completed", endedAt: 220, report: null }),
  ], turns);
  assert.ok(roster);
  assert.deepEqual(roster.rows.map((d) => d.id), ["old-running", "latest-a", "latest-b"]);
  assert.equal(roster.latest.id, "t3");
  assert.deepEqual(census(roster.rows).parts.map((p) => `${p.count} ${p.word}`), ["2 running"], "the census counts only what the strip shows");
});

test("the previous row counts every delegate the strip leaves out, naming only the failed and stopped", () => {
  const turns = [prompt("t1", 0, "a"), prompt("t2", 100, "b"), prompt("t3", 200, "c")];
  const delegates = [
    delegate("old-done", "t1", 20, { status: "completed", endedAt: 30, report: null }),
    delegate("old-stopped", "t1", 40, { status: "stopped", endedAt: 50 }),
    delegate("old-running", "t1", 60, { status: "running" }),
    delegate("mid-failed", "t2", 110, { status: "failed", endedAt: 120, error: null }),
    delegate("mid-failed-later", "t2", 130, { status: "failed", endedAt: 140, error: null }),
    delegate("latest", "t3", 210, { status: "failed", endedAt: 220, error: null }),
  ];
  const roster = selectRoster(delegates, turns);
  assert.ok(roster);
  assert.equal(roster.previous.total, 4);
  assert.deepEqual(roster.previous.parts.map((p) => `${p.count} ${p.word}`), ["2 failed", "1 stopped"]);
  const panelTotal = selectBatches(delegates, turns).flatMap((b) => b.delegates).length;
  assert.equal(roster.rows.length + roster.previous.total, panelTotal, "strip + N = the tab's total");
  assert.equal(panelTotal, delegates.length);
});

test("a part's click lands on the newest delegate with its status, among those it counts", () => {
  const turns = [prompt("t1", 0, "a"), prompt("t2", 100, "b"), prompt("t3", 200, "c")];
  const delegates = [
    delegate("mid-failed-later", "t2", 130, { status: "failed", endedAt: 140, error: null }),
    delegate("old-stopped", "t1", 40, { status: "stopped", endedAt: 50 }),
    delegate("mid-failed", "t2", 110, { status: "failed", endedAt: 120, error: null }),
    delegate("latest-failed", "t3", 210, { status: "failed", endedAt: 220, error: null }),
  ];
  const roster = selectRoster(delegates, turns);
  assert.ok(roster);
  assert.deepEqual(roster.previous.parts.map((p) => [p.word, p.newest]), [["failed", "mid-failed-later"], ["stopped", "old-stopped"]],
    "the strip's parts count the previous delegates only, so the latest batch's failure is not their target");
  assert.deepEqual(census(delegates).parts.map((p) => [p.word, p.newest]), [["failed", "latest-failed"], ["stopped", "old-stopped"]],
    "the tab header's parts count the whole thread");
});

test("with every delegate in the strip there is no previous row", () => {
  const roster = selectRoster([
    delegate("a", "t1", 10, { status: "completed", endedAt: 20, report: null }),
    delegate("b", "t1", 15, { status: "failed", endedAt: 25, error: null }),
  ], [prompt("t1", 0, "go")]);
  assert.deepEqual(roster?.previous, { total: 0, parts: [] });
});

test("selectRoster of no delegates is null, and the tab has no batches", () => {
  assert.equal(selectRoster([], [prompt("t1", 0, "a")]), null);
  assert.deepEqual(selectBatches([], [prompt("t1", 0, "a")]), []);
});

test("a batch's label is its prompt's first line, without wrapping quotes or a filler lead-in", () => {
  const label = (text: string) => oldestFirst([delegate("d", "t1", 10, { status: "running" })], [prompt("t1", 0, text)])[0].label;
  assert.equal(
    label('now, lets figure out why we only show the latest "batch of subagents" and what would be a good UI/UX'),
    'figure out why we only show the latest "batch of subagents" and what would be a good UI/UX',
  );
  assert.equal(label("“Fix the flaky test”\n\nIt fails one run in ten."), "Fix the flaky test");
  assert.equal(label("OK so please add a census"), "add a census");
  assert.equal(label("## Okay: let's go"), "go");
  assert.equal(label("now"), "now", "nothing left: the line as it was");
  assert.equal(label("nowhere to start"), "nowhere to start", "a filler is a whole word");
});

test("the census leads with attention: running, failed, stopped; done only when nothing else is left", () => {
  const mixed = census([
    delegate("s", "t", 1, { status: "stopped", endedAt: 2 }),
    delegate("c1", "t", 1, { status: "completed", endedAt: 2, report: null }),
    delegate("f", "t", 1, { status: "failed", endedAt: 2, error: null }),
    delegate("r", "t", 1, { status: "running" }),
    delegate("c2", "t", 1, { status: "completed", endedAt: 2, report: null }),
  ]);
  assert.equal(mixed.total, 5);
  assert.deepEqual(mixed.parts.map((p) => `${p.count} ${p.word}`), ["1 running", "1 failed", "1 stopped"]);
  const done = census([delegate("c", "t", 1, { status: "completed", endedAt: 2, report: null })]);
  assert.deepEqual([done.total, done.parts.map((p) => `${p.count} ${p.word}`)], [1, ["1 done"]]);
});

test("a batch's census keeps done, after what needs attention, zeros omitted", () => {
  const parts = batchCensus([
    delegate("c1", "t", 1, { status: "completed", endedAt: 2, report: null }),
    delegate("f", "t", 1, { status: "failed", endedAt: 2, error: null }),
    delegate("r", "t", 1, { status: "running" }),
    delegate("c2", "t", 1, { status: "completed", endedAt: 2, report: null }),
  ]);
  assert.deepEqual(parts.map((p) => `${p.count} ${p.word}`), ["1 running", "1 failed", "2 done"]);
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

test("a running row's detail is the trail's latest line in bb's compact words, never a raw command", () => {
  const d: Delegate = { ...realById("dafb9611c6-i5"), state: { status: "running" } }; // its steps end: reasoning, command, reasoning, handback
  const latest = trailItems(d).at(-1);
  assert.ok(latest?.kind === "group", "fixture premise: the latest line folds several steps");
  assert.equal(detailLine(d), latest.label);
  assert.match(detailLine(d), /^Running \d+ commands?/);
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

test("a settled background agent's meta line: started, ran, steps without reasoning, tool calls, tokens", () => {
  const d = realById("dafb9611c6-i4"); // usage 83,485 tokens over 22 tool uses
  assert.ok(d.steps && d.steps.length > 11, "fixture premise: reasoning rows beside the 11 counted steps");
  const startedAt = new Date(2026, 10, 5, 13, 58).getTime();
  const settled: Delegate = { ...d, startedAt, state: { status: "completed", endedAt: startedAt + 288_000, report: null } };
  assert.deepEqual(metaParts(settled), ["started 13:58", "ran 4m 48s", "11 steps", "22 tool calls", "83.5k tokens"]);
});

test("a running row's meta line has no ran part, and no usage parts until a task event carries usage", () => {
  const startedAt = new Date(2026, 10, 5, 9, 5).getTime();
  const running = { ...delegate("r", "t", startedAt, { status: "running" }), steps: realById("dafb9611c6-i4").steps };
  assert.deepEqual(metaParts(running), ["started 09:05", "11 steps"]);
  const withUsage = { ...running, usage: { totalTokens: 950, toolUses: 1, durationMs: 4_000 } };
  assert.deepEqual(metaParts(withUsage), ["started 09:05", "11 steps", "1 tool call", "950 tokens"]);
});

test("a delegate whose provider sends no child rows shows no step count; a big one counts tokens in millions", () => {
  const startedAt = new Date(2026, 10, 5, 13, 0).getTime();
  const acp: Delegate = { ...delegate("a", "t", startedAt, { status: "stopped", endedAt: startedAt + 35_000 }), steps: null };
  assert.deepEqual(metaParts(acp), ["started 13:00", "ran 35s"]);
  const big = { ...acp, steps: [], usage: { totalTokens: 1_240_000, toolUses: 310, durationMs: 9_000 } };
  assert.deepEqual(metaParts(big), ["started 13:00", "ran 35s", "0 steps", "310 tool calls", "1.2M tokens"]);
});

/** The tab's batches in the order prompts were sent. */
function oldestFirst(delegates: readonly Delegate[], turns: readonly Turn[]) {
  return selectBatches(delegates, turns).toReversed();
}

function realById(id: string): Delegate {
  const d = real.find((x) => x.id === id);
  assert.ok(d, `no fixture delegate ${id}`);
  return d;
}

/** A turn the message started, sent as it began; null: the agent continued on its own. */
function turn(id: string, startedAt: number, message: Pick<TurnMessage, "from" | "text"> | null): Turn {
  return { id, startedAt, messages: message ? [said(id, startedAt, message.from, message.text)] : [] };
}

/** A turn the user's own prompt started. */
function prompt(id: string, startedAt: number, text: string): Turn {
  return turn(id, startedAt, { from: "user", text });
}

function said(id: string, at: number, from: TurnMessage["from"], text: string): TurnMessage {
  return { id, at, from, text };
}

function delegate(id: string, turnId: string | null, startedAt: number, state: DelegateState): Delegate {
  return { id: id as DelegateId, origin: { kind: "delegation" }, providerId: "claude-code", turnId, title: id, startedAt, steps: [], scopes: [], usage: null, state };
}

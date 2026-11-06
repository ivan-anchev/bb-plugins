// The trail's and the transcript's lines, tested through trailItems and transcriptItems on real
// child rows. Every expected label is what bb's chat shows for the same rows: read off the chat live
// where the delegate's row is still there (claude-groups, claude-panel), and otherwise from bb's own compaction (ThreadScreen bundle `as` and `Wo`,
// lifted out of the bundle and run on the same rows, which matched on every fixture delegate).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ChildThread, DelegationRow, EventRow, StepRow, TimelineRow, WorkRow } from "./bb.ts";
import type { Delegate } from "./delegate.ts";
import { childDelegate } from "./child-threads.ts";
import { foldTaskEvents, normalise } from "./normalise.ts";
import { isHandback, isReasoning, stepLabel, trailSteps, transcriptSteps } from "./steps.ts";
import { trailItems, transcriptItems, type WorkItem } from "./work-groups.ts";

// See normalise.test.ts, child-threads.test.ts, and steps.test.ts for how each was taken.
const claude: { rows: TimelineRow[]; events: EventRow[] } = load("claude-thread.json");
const codex: { final: TimelineRow[]; midrun: TimelineRow[] } = load("codex-thread.json");
const children: { counter: { running: Read; settled: Read }; outcomes: { reused: { running: Read } } } = load("child-threads.json");
const edited: { row: StepRow } = load("claude-file-change.json");
// One delegation of thread thr_24dxq5xhph, "Worker: add REVIEW.md rules", as its timeline carried it
// (includeNestedRows=true), strings cut to 200 characters: its only file change creates a file.
const reviewWorker: { row: DelegationRow } = load("claude-groups.json");
// Another of thr_24dxq5xhph, "Worker: issue 08 round 3 (live line)", taken the same way, ids kept whole:
// three messages between four groups, its reasoning inside them.
const liveLineWorker: { row: DelegationRow } = load("claude-panel.json");

const delegates = normalise(claude.rows, foldTaskEvents(new Map(), claude.events), "claude-code");
// The same delegates mid-run, as bb's chat shows a delegation whose row is still pending: open.
const pending = normalise(delegationRows(claude.rows).map((row) => ({ ...row, status: "pending" as const, completedAt: null })), new Map(), "claude-code");

// Hand-built from real rows: no capture holds a repeated read, a held approval, mixed file changes,
// a thread tell, or a run cut short by reasoning or a user message.
const readRow = workRow("file-read", () => true);
// why: a completed command bb cannot read as a read, list, or search, so it counts as a command.
const command = workRow("command", (row) => row.status === "completed" && row.activityIntents.length === 0);
const reasoning = delegates.flatMap((d) => d.steps ?? []).find(isReasoning) ?? assert.fail("fixture premise: a reasoning step");
// why: a child thread's steps leave out what it was told, so this comes from its rows.
const userMessage = children.outcomes.reused.running.rows.find((row) => row.kind === "conversation" && row.role === "user") ?? assert.fail("fixture premise: a user message");
const edit = edited.row.kind === "work" && edited.row.workKind === "file-change" ? edited.row : assert.fail("fixture premise: a file change");

test("a settled delegate's run between messages folds into one line, in bb's words and order", () => {
  assert.deepEqual(Object.fromEntries(delegates.map((d) => [d.title, groupLines(trailItems(d))])), {
    "Prototype subagent strip variants": ["Explored 1 list, 2 files (1 error)", "Explored 1 list", "Ran 1 command", "Ran 1 command, ran 1 tool"],
    "Research t3code subagent visual language": ["Explored 5 files, 1 list, 3 searches, ran 2 commands, ran 1 tool"],
    "Research affectui components visual language": [
      "Explored 2 files, researched 1 web page, ran 2 commands",
      "Ran 3 commands, explored 1 file, 1 list, ran 1 tool (2 errors)",
    ],
    "Build Roster polish lab prototype": ["Explored 3 files", "Ran 1 command, explored 2 files", "Ran 1 command, explored 1 file", "Ran 1 command, ran 1 tool"],
    "Apply icon feedback to Roster lab": ["Ran 3 tools, explored 4 files, ran 1 command"],
    "Design inline row expansion in lab": ["Explored 5 files, ran 6 tools, ran 1 subagent"],
    "Spike: generic delegation data for plugin": ["Explored 2 files, ran 7 commands, ran 1 tool"],
    "How others derive subagent status/result": ["Explored 2 files, 2 searches, 2 lists, ran 5 commands, ran 1 tool"],
  });
});

test("the trail reads as bb's chat read it live for the same delegate", () => {
  const [d] = normalise([reviewWorker.row], new Map(), "claude-code");
  const items = trailItems(d);
  // Live, thr_24dxq5xhph's chat, its "Subagent finished Worker: add REVIEW.md rules" row expanded.
  assert.deepEqual(items.map(line), ["Explored 1 file, 1 search, 1 list, ran 2 tools, ran 4 commands, created 1 file"]);
  assert.deepEqual(stepsOf(items[0]), trailSteps(d.steps ?? []));
});

test("messages stay their own lines between groups, and nothing else of a group is a line", () => {
  const items = trailItems(byTitle(delegates, "Build Roster polish lab prototype"));
  assert.deepEqual(items.map((item) => item.kind), ["group", "step", "group", "step", "group", "step", "group"]);
  for (const item of items) if (item.kind === "step") assert.equal(item.step.kind, "conversation");
});

test("the handback counts as a tool and reasoning folds in, but neither shows as a step", () => {
  const d = byTitle(delegates, "Prototype subagent strip variants");
  const last = trailItems(d).at(-1);
  assert.ok(last?.kind === "group" && last.label === "Ran 1 command, ran 1 tool");
  assert.deepEqual(last.steps, [trailSteps(d.steps ?? []).at(-1)]); // the command; its reasoning and the handback fold in unseen
  const shown = delegates.flatMap((x) => trailItems(x).flatMap(stepsOf));
  assert.ok(!shown.some((row) => isReasoning(row) || isHandback(row)));
});

test("a run of one stays a step: Codex counters say a number between commands, so nothing folds", () => {
  for (const d of [...normalise(codex.final, new Map(), "codex"), ...normalise(codex.midrun, new Map(), "codex")]) {
    const items = trailItems(d);
    assert.ok(items.every((item) => item.kind === "step"), d.title);
    assert.equal(items.length, trailSteps(d.steps ?? []).length, d.title);
  }
});

test("while a delegation row is pending, only neighbours of one kind fold, and the latest is live, in the present tense", () => {
  const d = byTitle(pending, "Research t3code subagent visual language");
  // why: its rows end in reasoning and the handback, which bb's chat shows as its latest line; cut there, the reads are latest.
  const rows = d.scopes[0].rows;
  const items = trailItems(delegation(rows.slice(0, rows.findLastIndex((row) => row.kind === "work" && !isHandback(row)) + 1), "pending"));
  assert.deepEqual(groupLines(items), ["Explored 2 files", "Ran 1 command", "Explored 1 list, 2 files, 1 search", "Ran 1 command", "Exploring 1 file, 2 searches"]);
  assert.deepEqual(items.map((item) => item.live), [...items.slice(1).map(() => false), true]);
  // with them, bb's latest line is the handback, hidden here: no line is live, and none moves
  assert.deepEqual(trailItems(d).map((item) => [line(item), item.live]), items.map((item) => [line(item).replace("Exploring", "Explored"), false]));
});

test("while a delegation row is pending, a message still folds the whole run before it, in the past tense", () => {
  const items = trailItems(byTitle(pending, "Build Roster polish lab prototype"));
  assert.deepEqual(groupLines(items), ["Explored 3 files", "Ran 1 command, explored 2 files", "Ran 1 command, explored 1 file"]);
  assert.ok(items.every((item) => item.kind === "step" || !item.live));
});

test("a running child thread's latest step is the live line; settled, its two commands fold", () => {
  const latest = trailItems(childOf(children.counter.running)).at(-1);
  assert.ok(latest?.kind === "step" && latest.live);
  assert.equal(stepLabel(latest.step), "Running sleep 40 && echo one");
  assert.deepEqual(groupLines(trailItems(childOf(children.counter.settled))), ["Ran 2 commands"]);
});

// ---------------------------------------------------------------- what decides membership: bb's source, not the delegate's lifecycle

// A Claude Code background agent as it runs: bb's row reads completed from launch, so bb's chat folds
// its work closed and shows none of it live; only its task, still started, says it runs on.
const started = claude.events.filter((event) => event.type === "item/started" && event.data.item.type === "backgroundTask" && event.data.item.parentToolCallId === "dafb9611c6-i5");
const runningOn = byTitle(normalise(claude.rows, foldTaskEvents(new Map(), started), "claude-code"), "Research affectui components visual language");
const settledOn = byTitle(delegates, runningOn.title);

test("a Claude Code agent that runs on with a completed row reads its latest group in the present tense, live", () => {
  assert.equal(runningOn.state.status, "running", "fixture premise: its task runs");
  assert.equal(runningOn.scopes.at(-1)?.closed, true, "fixture premise: bb's row reads completed");
  const items = trailItems(runningOn);
  assert.deepEqual(items.map((item) => item.kind), ["group", "step", "group"]);
  assert.deepEqual(groupLines(items), ["Explored 2 files, researched 1 web page, ran 2 commands", "Running 3 commands, exploring 1 file, 1 list, running 1 tool (2 errors)"]);
  assert.deepEqual(items.map((item) => item.live), [false, false, true]);
});

test("settled, the same agent reads exactly bb's chat: every line in the past tense, none live", () => {
  assert.equal(settledOn.state.status, "completed", "fixture premise: its task completed");
  const items = trailItems(settledOn);
  // bb's words for these rows (see the first test): only the latest line's tense differs from the running agent's
  assert.deepEqual(groupLines(items), ["Explored 2 files, researched 1 web page, ran 2 commands", "Ran 3 commands, explored 1 file, 1 list, ran 1 tool (2 errors)"]);
  assert.ok(items.every((item) => !item.live));
});

test("running or settled, the agent's lines hold the same steps: liveness only words and highlights a line", () => {
  assert.deepEqual(trailItems(runningOn).map(stepsOf), trailItems(settledOn).map(stepsOf));
});

test("a child thread's settled turn folds closed while the child runs on, even as its latest line", () => {
  const read = children.outcomes.reused.running;
  // why: cut where its second turn's group is the latest row, the moment before that turn's answer lands.
  const at = read.rows.findLastIndex((row) => row.kind === "turn");
  const turn = read.rows[at];
  assert.ok(turn.kind === "turn" && turn.children, "fixture premise: a settled turn group");
  const rows = [...read.rows.slice(0, at), { ...turn, children: [...turn.children, { ...readRow, id: "extra-read" }] }];
  const d = childOf({ ...read, rows });
  assert.equal(d.state.status, "running", "fixture premise: the child runs");
  assert.deepEqual(trailItems(d).map((item) => [line(item), item.live]).slice(-1), [["Ran 1 command, explored 1 file", false]]);
});

// ---------------------------------------------------------------- which line is live: decided on bb's lines, before hiding

test("a run before pending reasoning reads past tense: bb's latest line is the reasoning, hidden here", () => {
  const items = trailItems(delegation([command, { ...command, id: "c2" }, { ...reasoning, status: "pending" }], "pending"));
  assert.deepEqual(items.map(line), ["Ran 2 commands"]);
  assert.ok(items.every((item) => !item.live));
});

test("a run a user message folds closed never reads live, though the user message is no latest line", () => {
  const items = trailItems(delegation([command, { ...command, id: "c2" }, userMessage], "pending"));
  assert.deepEqual(groupLines(items), ["Ran 2 commands"]);
  assert.ok(items.every((item) => !item.live));
  // the same run with nothing after it is bb's active bundle
  assert.deepEqual(trailItems(delegation([command, { ...command, id: "c2" }], "pending")).map((item) => [line(item), item.live]), [["Running 2 commands", true]]);
});

// ---------------------------------------------------------------- a successful `bb thread tell` is a message to bb's chat

const tell = (id: string, text: string, exitCode: number | null): WorkRow => ({ ...command, id, command: text, exitCode });
const TELL = "bb thread tell thr_24dxq5xhph 'Done: see the report.'";

test("a successful bb thread tell stays its own line and splits the run, as bb shows it as a message", () => {
  const items = trailItems(delegation([readRow, command, tell("t", TELL, 0), { ...command, id: "c2" }, { ...readRow, id: "r2", path: "other.ts" }], "completed"));
  // why: like a question, it folds the run before it as an open run: a read, then a command, each its own line.
  assert.deepEqual(items.map(line), [stepLabel(readRow), stepLabel(command), `Ran ${TELL}`, "Ran 1 command, explored 1 file"]);
});

test("a bb thread tell that failed, or one inside a compound command, folds as an ordinary command", () => {
  for (const text of [TELL, `${TELL} && echo sent`]) {
    const exitCode = text === TELL ? 1 : 0;
    const items = trailItems(delegation([readRow, command, tell("t", text, exitCode), { ...command, id: "c2" }], "completed"));
    assert.deepEqual(items.map(line), ["Explored 1 file, ran 3 commands"], text);
  }
});

test("a read of the file just read folds into it: counted once, shown once", () => {
  const [group] = trailItems(delegation([readRow, { ...readRow, id: "read-again" }, command], "completed"));
  assert.ok(group.kind === "group");
  assert.equal(group.label, "Explored 1 file, ran 1 command");
  assert.equal(group.steps.length, 2);
});

test("steps all held at one approval read as waiting for it, or denied, commands first", () => {
  const held = (row: WorkRow, id: string, approvalStatus: "waiting_for_approval" | "denied"): WorkRow => {
    switch (row.workKind) {
      case "command":
      case "file-change": return { ...row, id, approvalStatus };
      default: return assert.fail("only commands and file changes are held here");
    }
  };
  const waiting = [held(edit, "e", "waiting_for_approval"), held(command, "c1", "waiting_for_approval"), held(command, "c2", "waiting_for_approval")];
  assert.deepEqual(groupLines(trailItems(delegation(waiting, "completed"))), ["Waiting for approval on 2 commands, 1 file change"]);
  assert.deepEqual(groupLines(trailItems(delegation(waiting.map((row) => held(row, row.id, "denied")), "completed"))), ["Denied 2 commands, 1 file change"]);
  const mixed = [held(command, "c1", "waiting_for_approval"), held(command, "c2", "denied")];
  assert.deepEqual(groupLines(trailItems(delegation(mixed, "completed"))), ["Ran 2 commands"]);
});

test("file changes of one action name it; a mix reads as edits; live, they read in the present tense", () => {
  const created = (path: string) => ({ ...edit, id: path, change: { ...edit.change, kind: "add", path } });
  assert.deepEqual(groupLines(trailItems(delegation([created("a.ts"), created("b.ts")], "completed"))), ["Created 2 files"]);
  assert.deepEqual(groupLines(trailItems(delegation([created("a.ts"), created("b.ts")], "pending"))), ["Creating 2 files"]);
  assert.deepEqual(groupLines(trailItems(delegation([edit, created("b.ts")], "completed"))), ["Edited 2 files"]);
});

// ---------------------------------------------------------------- the transcript: the same lines, reasoning in them

test("the transcript reads as bb's chat read it live for the same delegate, reasoning folded into its groups", () => {
  const [d] = normalise([liveLineWorker.row], new Map(), "claude-code");
  const items = transcriptItems(d);
  // Live, thr_24dxq5xhph's chat, its "Subagent finished Worker: issue 08 round 3 (live line)" row expanded.
  assert.deepEqual(items.map(line), [
    "Explored 10 files, 1 list, 1 search, ran 1 tool, ran 4 commands, edited 1 file (1 error)",
    "Now the change in work-groups.ts.",
    "Edited 1 file, ran 5 commands, explored 1 file, 2 searches",
    "Update the docs (SKILL.md trail bullet and PLUGIN_OVERVIEW).",
    "Edited 2 files, ran 6 commands, explored 2 lists, 1 file, 1 search, ran 1 tool",
    `::browser-preview{session="7bd5a0b5-413d-4050-9aee-fcadf4d89a4d"}`,
    "Ran 10 commands, explored 3 searches, 2 files, ran 1 tool (1 error)",
  ]);
  // bb opens the first group to "Thought", "Read brief-worker-08-r3.md", "Thought", ...: every step in order, reasoning too
  assert.deepEqual(items.flatMap(stepsOf), transcriptSteps(d.steps ?? []));
  assert.ok(stepsOf(items[0]).some(isReasoning));
});

test("the transcript holds the trail's lines in the trail's words, with reasoning added and nothing else", () => {
  const all = [...delegates, ...pending, runningOn, ...normalise(codex.final, new Map(), "codex"), childOf(children.counter.settled)];
  for (const d of all) {
    const transcript = transcriptItems(d);
    const withoutReasoning = transcript.flatMap((item): WorkItem[] => {
      if (item.kind === "group") return [{ ...item, steps: item.steps.filter((row) => !isReasoning(row)) }];
      return isReasoning(item.step) ? [] : [item];
    });
    assert.deepEqual(withoutReasoning, trailItems(d), d.title);
    assert.ok(!transcript.flatMap(stepsOf).some(isHandback), d.title);
  }
});

test("reasoning a message closes off on its own stays a Thinking line in the transcript, where the trail drops it", () => {
  const message = delegates.flatMap((x) => x.steps ?? []).find((row) => row.kind === "conversation" && row.role === "assistant") ?? assert.fail("fixture premise: a message");
  const d = delegation([reasoning, message, command], "completed");
  assert.deepEqual(transcriptItems(d).map(stepsOf), [[reasoning], [message], [command]]);
  assert.deepEqual(trailItems(d).map(stepsOf), [[message], [command]]);
});

test("pending reasoning, bb's latest line, is the transcript's live line, where the trail shows none live", () => {
  const thinking = { ...reasoning, status: "pending" as const };
  const d = delegation([command, { ...command, id: "c2" }, thinking], "pending");
  assert.deepEqual(transcriptItems(d).map((item) => [line(item), item.live]), [["Ran 2 commands", false], [stepLabel(thinking), true]]);
  assert.ok(trailItems(d).every((item) => !item.live));
});

// ---------------------------------------------------------------- helpers

type Read = { child: ChildThread; rows: TimelineRow[] };

/** A delegation row of thread thr_24dxq5xhph carrying these child rows, settled or still pending. */
function delegation(rows: readonly TimelineRow[], status: "completed" | "pending"): Delegate {
  const [d] = normalise([{ ...reviewWorker.row, status, childRows: [...rows] }], new Map(), "claude-code");
  return d;
}

function delegationRows(rows: readonly TimelineRow[]): DelegationRow[] {
  return rows.flatMap((row) => (row.kind === "turn" ? delegationRows(row.children ?? []) : row.kind === "work" && row.workKind === "delegation" ? [row] : []));
}

function load<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

/** A line as bb's chat writes it: a group's words with its failures, or a step's own label. */
function line(item: WorkItem): string {
  return item.kind === "group" ? `${item.label}${item.note ? ` (${item.note})` : ""}` : stepLabel(item.step);
}

function groupLines(items: readonly WorkItem[]): string[] {
  return items.flatMap((item) => (item.kind === "group" ? [line(item)] : []));
}

function stepsOf(item: WorkItem): readonly StepRow[] {
  return item.kind === "group" ? item.steps : [item.step];
}

function byTitle(list: readonly Delegate[], title: string): Delegate {
  const d = list.find((x) => x.title === title);
  assert.ok(d, `no fixture delegate ${title}`);
  return d;
}

function childOf(read: Read): Delegate {
  return childDelegate(read.child, read.rows, []);
}

function workRow<K extends WorkRow["workKind"]>(workKind: K, match: (row: Extract<WorkRow, { workKind: K }>) => boolean): Extract<WorkRow, { workKind: K }> {
  const isKind = (step: StepRow): step is Extract<WorkRow, { workKind: K }> => step.kind === "work" && step.workKind === workKind;
  const row = delegates.flatMap((d) => d.steps ?? []).filter(isKind).find(match);
  assert.ok(row, `fixture premise: a ${workKind} step`);
  return row;
}

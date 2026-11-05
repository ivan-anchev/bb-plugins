import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { StepRow, TimelineRow } from "./bb.ts";
import { firstLine, isReasoning, splitReport, stepFailed, stepKind, stepLabel, trailSteps, transcriptSteps } from "./steps.ts";

// The real child rows of the fixture's delegates (see normalise.test.ts for how it was taken).
const fixture: { rows: TimelineRow[] } = JSON.parse(readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"));
const steps = transcriptSteps(fixture.rows.flatMap((row) => (row.kind === "turn" ? (row.children ?? []) : [])).flatMap(childRowsOf));

test("a tool step reads as its title, without a verb, whether it runs or not", () => {
  const tool = first((r) => r.kind === "work" && r.workKind === "tool");
  assert.ok(tool.kind === "work");
  assert.equal(stepLabel(tool), "emil-design-foundations");
  assert.equal(stepLabel({ ...tool, status: "pending" }), "emil-design-foundations");
});

test("an assistant message reads as its first line; reasoning as its title", () => {
  assert.equal(stepLabel(first((r) => r.kind === "conversation")), "I'll start by reading the emil-prototype skill and its picker docs.");
  assert.equal(stepLabel(first((r) => r.kind === "system")), "Thought");
});

// Live rows from the fixtures' midrun captures: a Codex child mid `sleep`, a Claude Code child blocked on
// its question, Codex's delegations while its agents ran (see child-threads.test.ts, normalise.test.ts).
const children: { counter: { running: { rows: TimelineRow[] } }; outcomes: { waiting: { rows: TimelineRow[] } } } = JSON.parse(
  readFileSync(new URL("./fixtures/child-threads.json", import.meta.url), "utf8"),
);
const midrun: { midrun: TimelineRow[] } = JSON.parse(readFileSync(new URL("./fixtures/codex-thread.json", import.meta.url), "utf8"));
// One of this issue's own edits, as thread thr_24dxq5xhph's timeline carried it (includeNestedRows=true),
// strings cut to 200 characters: no other fixture holds a file change.
const edited: { row: StepRow } = JSON.parse(readFileSync(new URL("./fixtures/claude-file-change.json", import.meta.url), "utf8"));

test("a running command reads as Running, a finished one as Ran", () => {
  const running = children.counter.running.rows.find((r) => r.kind === "work" && r.workKind === "command");
  assert.ok(running?.kind === "work" && running.status === "pending", "fixture premise: the child's command is running");
  assert.equal(stepLabel(running), "Running sleep 40 && echo one");
  assert.equal(stepLabel({ ...running, status: "completed" }), "Ran sleep 40 && echo one");
  // why: an error or a stop has ended the step as surely as completing it; this real command exited 1.
  const failed = first((r) => r.kind === "work" && r.workKind === "command");
  assert.ok(failed.kind === "work" && failed.status === "error");
  assert.match(stepLabel(failed), /^Ran ls \/Users\/ivananchev\/\.claude\/skills\/emil-prototype\//);
  assert.equal(stepLabel({ ...running, status: "interrupted" }), "Ran sleep 40 && echo one");
});

test("a read, an edit, and a fetch read as Reading, Editing, Fetching while they run, and Read, Edited, Fetched after", () => {
  // why: these finish within a second, so no midrun capture holds one live; each is its real row as bb sends it while pending.
  const read = first((r) => r.kind === "work" && r.workKind === "file-read");
  const fetched = first((r) => r.kind === "work" && r.workKind === "web-fetch");
  const edit = edited.row;
  assert.ok(read.kind === "work" && fetched.kind === "work" && edit.kind === "work" && edit.status === "completed");
  assert.match(stepLabel({ ...read, status: "pending" }), /^Reading \/Users\/ivananchev\/\.bb\/thread-storage\//);
  assert.match(stepLabel(read), /^Read \/Users\/ivananchev\/\.bb\/thread-storage\//);
  assert.equal(stepLabel({ ...edit, status: "pending" }), "Editing plugins/subagents-strip/steps.ts");
  assert.equal(stepLabel(edit), "Edited plugins/subagents-strip/steps.ts");
  assert.equal(stepLabel({ ...fetched, status: "pending" }), "Fetching https://www.affectui.com/components");
  assert.equal(stepLabel(fetched), "Fetched https://www.affectui.com/components");
});

test("a pending question reads as Asking, a pending delegation as Starting; answered and settled, Asked and Started", () => {
  const question = children.outcomes.waiting.rows.find((r) => r.kind === "work" && r.workKind === "question");
  assert.ok(question?.kind === "work" && question.status === "pending", "fixture premise: the child waits on its question");
  assert.equal(stepLabel(question), "Asking a question");
  assert.equal(stepLabel({ ...question, status: "completed" }), "Asked a question");
  const starting = midrun.midrun.find((r) => r.kind === "work" && r.workKind === "delegation");
  assert.ok(starting?.kind === "work" && starting.status === "pending", "fixture premise: the delegation runs");
  assert.equal(stepLabel(starting), "Starting /root/counter_a");
  const started = fixture.rows.flatMap((r) => (r.kind === "turn" ? (r.children ?? []) : [])).find((r) => r.kind === "work" && r.workKind === "delegation");
  assert.ok(started?.kind === "work" && started.status === "completed");
  assert.equal(stepLabel(started), "Started Prototype subagent strip variants");
});

// Hand-built rows: no captured thread holds these kinds. Each is typed as bb's own row, so the
// compiler checks every field against the pinned SDK; the fields common to every work row are shared.
type WorkRow = Extract<StepRow, { kind: "work" }>;
const pendingWork: Pick<WorkRow, "kind" | "id" | "threadId" | "turnId" | "createdAt" | "startedAt" | "sourceSeqStart" | "sourceSeqEnd" | "status"> = {
  kind: "work", id: "hand-built", threadId: "thr_hand_built", turnId: null, createdAt: 0, startedAt: 0, sourceSeqStart: 0, sourceSeqEnd: 0, status: "pending",
};
const handBuilt: [WorkRow, live: string, ended: string][] = [
  [{ ...pendingWork, workKind: "image-view", callId: "c", completedAt: null, path: "shot.png" }, "Viewing shot.png", "Viewed shot.png"],
  [
    { ...pendingWork, workKind: "search", callId: "c", completedAt: null, cmd: null, mode: "content", path: "plugins", query: "isLive" },
    "Searching isLive",
    "Searched isLive",
  ],
  [{ ...pendingWork, workKind: "web-search", callId: "c", completedAt: null, queries: ["bb plugin sdk"] }, "Searching bb plugin sdk", "Searched bb plugin sdk"],
  [
    { ...pendingWork, workKind: "image-generation", callId: "c", completedAt: null, error: null, path: null, prompt: "a strip", transparentBackground: false },
    "Generating an image",
    "Generated an image",
  ],
  [
    { ...pendingWork, workKind: "plan-steps", callId: "c", completedAt: null, explanation: null, steps: [{ step: "Add tests", status: "active" }] },
    "Updating the plan",
    "Updated the plan",
  ],
  [
    { ...pendingWork, workKind: "approval", approvalKind: "file-edit", interactionId: "i", lifecycle: "waiting", target: { itemId: "c", toolName: "Edit" } },
    "Asking for approval",
    "Asked for approval",
  ],
  [
    {
      ...pendingWork, workKind: "workflow", completedAt: null, description: "Review the diff", error: null, itemId: "i", model: null, summary: null,
      taskStatus: "running", taskType: "local_workflow", usage: null, workflow: null, workflowName: "review",
    },
    "Starting Review the diff",
    "Started Review the diff",
  ],
];

for (const [row, live, ended] of handBuilt) {
  test(`the ${row.workKind} step reads "${live}" while it runs and "${ended}" once it completes`, () => {
    assert.equal(stepLabel(row), live);
    assert.equal(stepLabel({ ...row, status: "completed" }), ended);
  });
}

test("a step status newer than the pinned SDK reads in the past tense and never throws", () => {
  // why: JSON.parse types it as the narrowed param without a cast, as a newer bb host would send it.
  const queued: StepRow = JSON.parse('{"kind":"work","workKind":"command","command":"sleep 9","status":"queued"}');
  assert.equal(stepLabel(queued), "Ran sleep 9");
});

test("a row kind newer than the pinned SDK reads as its title, else Working, and never throws", () => {
  // why: JSON.parse types these as the narrowed param without a cast, as a newer bb host would send them.
  const titled: StepRow = JSON.parse('{"kind":"work","workKind":"teleport","presentation":{"title":"Teleported home"}}');
  const bare: StepRow = JSON.parse('{"kind":"work","workKind":"teleport"}');
  const newKind: StepRow = JSON.parse('{"kind":"hologram","presentation":{"title":7}}');
  assert.equal(stepLabel(titled), "Teleported home");
  assert.equal(stepLabel(bare), "Working");
  assert.equal(stepLabel(newKind), "Working");
});

test("a step's kind follows what it did: ran, read, fetched, called a tool, or said", () => {
  assert.equal(stepKind(first((r) => r.kind === "work" && r.workKind === "command")), "command");
  assert.equal(stepKind(first((r) => r.kind === "work" && r.workKind === "file-read")), "read");
  assert.equal(stepKind(first((r) => r.kind === "work" && r.workKind === "web-fetch")), "web");
  assert.equal(stepKind(first((r) => r.kind === "work" && r.workKind === "tool")), "tool");
  assert.equal(stepKind(first((r) => r.kind === "conversation")), "message");
  assert.equal(stepKind(first((r) => r.kind === "system")), "note");
});

test("a row kind newer than the pinned SDK takes the generic tool kind and never throws", () => {
  const newWork: StepRow = JSON.parse('{"kind":"work","workKind":"teleport"}');
  const newKind: StepRow = JSON.parse('{"kind":"hologram"}');
  assert.equal(stepKind(newWork), "tool");
  assert.equal(stepKind(newKind), "tool");
});

test("a step failed when it ended in error or its command exited non-zero", () => {
  const exited = first((r) => r.kind === "work" && r.workKind === "command" && r.exitCode === 1);
  const passed = first((r) => r.kind === "work" && r.workKind === "command" && r.exitCode === 0);
  assert.equal(stepFailed(exited), true);
  assert.equal(stepFailed(passed), false);
  // why: Claude Code also marks such a row "error"; a provider that only reports the exit code still fails it.
  assert.ok(passed.kind === "work" && passed.workKind === "command");
  assert.equal(stepFailed({ ...passed, exitCode: 2 }), true);
  assert.equal(stepFailed(first((r) => r.kind === "conversation")), false);
  // why: a failed tool call reports its status, not an exit code; built from a real tool row.
  const tool = first((r) => r.kind === "work" && r.workKind === "tool");
  assert.ok(tool.kind === "work");
  assert.equal(stepFailed({ ...tool, status: "error" }), true);
  assert.equal(stepFailed(tool), false);
});

test("reasoning is the transcript's Thinking text, and only reasoning leaves the trail", () => {
  const thought = first(isReasoning);
  assert.ok(isReasoning(thought));
  assert.equal(thought.detail, "I'm going to read through the skill files first to see what guidance they give.");
  // why: other operation rows (a warning here, built from the real reasoning row) are steps the trail keeps.
  const warning: StepRow = { ...thought, operationKind: "warning" };
  assert.equal(isReasoning(warning), false);
  assert.deepEqual(trailSteps([thought, warning]), [warning]);
});

test("firstLine skips blank lines and drops heading, list, bold, and code marks", () => {
  assert.equal(firstLine("\n\n# t3code **visuals**: findings\nmore"), "t3code visuals: findings");
  assert.equal(firstLine("- ran `npm run check`"), "ran npm run check");
  assert.equal(firstLine("  \n \n"), "");
});

// A Codex counter's real child rows (see normalise.test.ts): numbers said between `sleep` commands, then a closing message.
const codex: { final: TimelineRow[] } = JSON.parse(readFileSync(new URL("./fixtures/codex-thread.json", import.meta.url), "utf8"));
const [counterRow] = codex.final.flatMap((row) => (row.kind === "turn" ? (row.children ?? []) : []));
const counter = transcriptSteps(childRowsOf(counterRow));

test("splitReport takes the last assistant message as the report and drops only that row", () => {
  const closing = counter.at(-1);
  assert.ok(closing?.kind === "conversation" && closing.role === "assistant");
  assert.deepEqual(splitReport(counter), { steps: counter.slice(0, -1), report: closing.text });
});

test("splitReport skips a blank message and reports the last message even when steps follow it", () => {
  const [one, sleep] = counter;
  assert.ok(one.kind === "conversation");
  const blank: StepRow = { ...one, id: "blank", text: " \n" };
  assert.deepEqual(splitReport([one, sleep, blank]), { steps: [sleep, blank], report: "1" });
});

test("splitReport with no assistant message reports nothing and keeps every step", () => {
  const [one, sleep] = counter;
  assert.ok(one.kind === "conversation" && one.role === "assistant");
  // why: no captured delegate has a user row; this is the real "1" message as the user would have sent it.
  const said: Extract<StepRow, { kind: "conversation"; role: "user" }> = {
    ...one,
    role: "user",
    initiator: "user",
    mentions: [],
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
  assert.deepEqual(splitReport([sleep, said]), { steps: [sleep, said], report: null });
  assert.deepEqual(splitReport([]), { steps: [], report: null });
});

function first(match: (row: StepRow) => boolean): StepRow {
  const row = steps.find(match);
  assert.ok(row, "fixture premise: a step of this kind exists");
  return row;
}

function childRowsOf(row: TimelineRow): TimelineRow[] {
  return row.kind === "work" && row.workKind === "delegation" ? (row.childRows ?? []) : [];
}

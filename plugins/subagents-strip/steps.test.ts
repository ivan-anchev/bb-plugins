import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { StepRow, TimelineRow } from "./bb.ts";
import { firstLine, isReasoning, stepFailed, stepKind, stepLabel, trailSteps, transcriptSteps } from "./steps.ts";

// The real child rows of the fixture's delegates (see normalise.test.ts for how it was taken).
const fixture: { rows: TimelineRow[] } = JSON.parse(readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"));
const steps = transcriptSteps(fixture.rows.flatMap((row) => (row.kind === "turn" ? (row.children ?? []) : [])).flatMap(childRowsOf));

test("a command step reads as Ran and its command line", () => {
  const row = first((r) => r.kind === "work" && r.workKind === "command");
  assert.ok(row.kind === "work" && row.workKind === "command");
  assert.equal(stepLabel(row), `Ran ${row.command}`);
  assert.match(stepLabel(row), /^Ran ls \/Users\/ivananchev\/\.claude\/skills\/emil-prototype\//);
});

test("a file read reads as Read and its path, a fetch as Fetched and its URL", () => {
  assert.match(stepLabel(first((r) => r.kind === "work" && r.workKind === "file-read")), /^Read \/Users\/ivananchev\/\.bb\/thread-storage\//);
  assert.equal(stepLabel(first((r) => r.kind === "work" && r.workKind === "web-fetch")), "Fetched https://www.affectui.com/components");
});

test("a tool step reads as its title, without a verb", () => {
  assert.equal(stepLabel(first((r) => r.kind === "work" && r.workKind === "tool")), "emil-design-foundations");
});

test("an assistant message reads as its first line; reasoning as its title", () => {
  assert.equal(stepLabel(first((r) => r.kind === "conversation")), "I'll start by reading the emil-prototype skill and its picker docs.");
  assert.equal(stepLabel(first((r) => r.kind === "system")), "Thought");
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

function first(match: (row: StepRow) => boolean): StepRow {
  const row = steps.find(match);
  assert.ok(row, "fixture premise: a step of this kind exists");
  return row;
}

function childRowsOf(row: TimelineRow): TimelineRow[] {
  return row.kind === "work" && row.workKind === "delegation" ? (row.childRows ?? []) : [];
}

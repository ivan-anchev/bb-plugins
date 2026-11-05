import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { StepRow, TimelineRow } from "./bb.ts";
import { firstLine, stepLabel, transcriptSteps } from "./steps.ts";

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

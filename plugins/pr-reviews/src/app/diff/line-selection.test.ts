import assert from "node:assert/strict";
import { test } from "node:test";
import type { SelectedLineRange } from "@pierre/diffs";
import { highlightOf, linesPicked, linesPicking, NO_LINES, openedFromFinding, settled, type DiffLines } from "./line-selection.ts";

const LINE_5: SelectedLineRange = { start: 5, end: 5, side: "additions" };
const LINES_5_7: SelectedLineRange = { start: 5, end: 7, side: "additions" };
const LINES_5_9: SelectedLineRange = { start: 5, end: 9, side: "additions" };
const LINE_20: SelectedLineRange = { start: 20, end: 20, side: "additions" };
const CROSS: SelectedLineRange = { start: 26, end: 63, side: "deletions", endSide: "additions" };

const WRITING = { kind: "writing", sent: null } as const;
const COMMENTED = { kind: "commented", url: "https://github.com/o/r/pull/1#discussion_r1", body: "Ship it" } as const;

const withDraft = (lines: DiffLines, draft: string): DiffLines => ({ ...lines, draft });

test("a drag highlights its lines as it goes, and the box opens under them once the reader lets go", () => {
  const pressed = linesPicking(NO_LINES, LINE_5);
  const dragged = linesPicking(linesPicking(pressed, LINES_5_7), LINES_5_9);

  assert.deepEqual(highlightOf(pressed), LINE_5);
  assert.equal(dragged.box, null);
  assert.deepEqual(highlightOf(dragged), LINES_5_9);
  const picked = linesPicked(dragged, LINES_5_9);
  assert.deepEqual(picked, { picking: null, box: { at: LINES_5_9, opened: 1, finding: null, stage: WRITING, lit: true }, draft: "" });
  assert.deepEqual(highlightOf(picked), LINES_5_9);
});

test("the box stays where it is through a drag elsewhere, then moves to the new lines with its draft", () => {
  const open = withDraft(linesPicked(NO_LINES, LINE_5), "Why five?");
  const dragging = linesPicking(open, LINES_5_9);

  assert.equal(dragging.box, open.box);
  assert.deepEqual(highlightOf(dragging), LINES_5_9);
  const moved = linesPicked(dragging, CROSS);
  assert.deepEqual(moved.box, { at: CROSS, opened: 2, finding: null, stage: WRITING, lit: true });
  assert.equal(moved.draft, "Why five?");
});

test("a report of the box's own lines changes nothing, so the box keeps its focus and its finding", () => {
  const open = openedFromFinding(NO_LINES, LINE_5, 2, "");

  assert.equal(linesPicked(open, { ...LINE_5 }), open);
  assert.equal(linesPicking(linesPicking(NO_LINES, CROSS), { ...CROSS }).picking, CROSS);
});

test("the same numbers on another side are other lines", () => {
  const open = linesPicked(NO_LINES, { start: 26, end: 26, side: "deletions" });

  assert.equal(linesPicked(open, { start: 26, end: 26, side: "additions" }).box?.opened, 2);
});

test("pressing the one selected line again closes an empty box, and leaves a box with a draft in place with nothing selected", () => {
  const open = linesPicked(NO_LINES, LINE_5);

  assert.deepEqual(linesPicked(open, null), NO_LINES);
  const kept = linesPicked(withDraft(open, "keep me"), null);
  assert.deepEqual(kept, { picking: null, box: { ...open.box!, lit: false }, draft: "keep me" });
  assert.equal(highlightOf(kept), null);
  assert.equal(linesPicked(kept, LINE_5).box?.opened, 2, "picking its lines again opens the box afresh");
});

test("a finding's button selects its line and opens the box under it, prefilled only when the draft is empty", () => {
  const comment = openedFromFinding(NO_LINES, LINE_20, 1, "**Title**\n\nBody");

  assert.deepEqual(comment, { picking: null, box: { at: LINE_20, opened: 1, finding: 1, stage: WRITING, lit: true }, draft: "**Title**\n\nBody" });
  assert.equal(openedFromFinding(withDraft(linesPicked(NO_LINES, LINE_5), "mine"), LINE_20, 1, "**Title**").draft, "mine");
  assert.equal(openedFromFinding(withDraft(NO_LINES, "  \n"), LINE_20, 1, "**Title**").draft, "**Title**");
  assert.equal(openedFromFinding(NO_LINES, LINE_20, 1, "").draft, "", "Ask opens it empty");
});

test("a finding's box moved to other lines is no longer about the finding", () => {
  const asked = openedFromFinding(NO_LINES, LINE_20, 3, "");

  assert.equal(linesPicked(asked, LINE_5).box?.finding, null);
});

test("a box whose draft went shows the outcome where it was, its lines unselected and the draft gone", () => {
  const open = withDraft(linesPicked(NO_LINES, LINES_5_7), "Ship it");
  const done = settled(open, COMMENTED, "Ship it");

  assert.deepEqual(done.box, { ...open.box!, stage: { kind: "done", outcome: COMMENTED }, lit: false });
  assert.equal(done.draft, "");
  assert.equal(highlightOf(done), null);
  assert.deepEqual(linesPicked(done, LINES_5_7).box, { at: LINES_5_7, opened: 2, finding: null, stage: WRITING, lit: true }, "picking lines again opens a fresh box");
});

test("a draft changed while it was sent stays open and unsent in the box, which says the request went", () => {
  const open = withDraft(linesPicked(NO_LINES, LINES_5_7), "Ship it, and more");
  const kept = settled(open, COMMENTED, "Ship it");

  assert.deepEqual(kept, { ...open, box: { ...open.box!, stage: { kind: "writing", sent: COMMENTED } } });
  assert.deepEqual(highlightOf(kept), LINES_5_7, "its lines stay selected");
  assert.equal(linesPicked(kept, LINES_5_7), kept, "the box stays open on its own lines");
  const resent = settled(kept, { kind: "asked" }, "Ship it, and more");
  assert.deepEqual([resent.box?.stage, resent.draft], [{ kind: "done", outcome: { kind: "asked" } }, ""], "sending the changed text finishes the box");
});

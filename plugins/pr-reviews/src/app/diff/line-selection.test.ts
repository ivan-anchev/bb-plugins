import assert from "node:assert/strict";
import { test } from "node:test";
import type { SelectedLineRange } from "@pierre/diffs";
import { escapeActionOf, selectionPicked, selectionWhilePicking, type LineSelection } from "./line-selection.ts";

const LINE_5: SelectedLineRange = { start: 5, end: 5, side: "additions" };
const LINES_5_7: SelectedLineRange = { start: 5, end: 7, side: "additions" };
const LINES_5_9: SelectedLineRange = { start: 5, end: 9, side: "additions" };
const CROSS: SelectedLineRange = { start: 26, end: 63, side: "deletions", endSide: "additions" };

test("a drag highlights its lines as it goes, and the action row opens under them once the reader lets go", () => {
  const pressed = selectionWhilePicking(null, LINE_5);
  const dragging = selectionWhilePicking(pressed, LINES_5_7);
  const dragged = selectionWhilePicking(dragging, LINES_5_9);

  assert.deepEqual([pressed, dragging, dragged], [
    { range: LINE_5, panel: null },
    { range: LINES_5_7, panel: null },
    { range: LINES_5_9, panel: null },
  ]);
  assert.deepEqual(selectionPicked(dragged, LINES_5_9), { range: LINES_5_9, panel: "actions" });
});

test("a shift-click moves the selected lines to the new range, across sides too", () => {
  const selected = selectionPicked(null, LINE_5);

  assert.deepEqual(selectionPicked(selectionWhilePicking(selected, CROSS), CROSS), { range: CROSS, panel: "actions" });
});

test("a report of the lines as they already are changes nothing", () => {
  const picking = selectionWhilePicking(null, CROSS);
  const picked = selectionPicked(picking, CROSS);

  assert.equal(selectionWhilePicking(picking, { ...CROSS }), picking);
  assert.equal(selectionPicked(picked, { ...CROSS }), picked);
});

test("the same numbers on another side are other lines", () => {
  const current = selectionPicked(null, { start: 26, end: 26, side: "deletions" });

  assert.equal(selectionPicked(current, { start: 26, end: 26, side: "additions" })?.range.side, "additions");
});

test("pressing the one selected line again and letting go clears it", () => {
  assert.equal(selectionPicked(selectionPicked(null, LINE_5), null), null);
});

test("while a box is open, gestures keep its lines: the reader picks others after closing it", () => {
  const asking: LineSelection = { range: LINES_5_9, panel: "ask" };

  assert.equal(selectionWhilePicking(asking, LINE_5), asking);
  assert.equal(selectionPicked(asking, LINE_5), asking);
  assert.equal(selectionPicked(asking, null), asking);
});

test("Esc is bb's own with nothing selected, clears lines with no box open, and is the box's while one is", () => {
  assert.equal(escapeActionOf(null), "none");
  assert.equal(escapeActionOf({ range: LINE_5, panel: null }), "clear");
  assert.equal(escapeActionOf({ range: LINE_5, panel: "actions" }), "clear");
  assert.equal(escapeActionOf({ range: LINE_5, panel: "ask" }), "box");
});

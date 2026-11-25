import assert from "node:assert/strict";
import { test } from "node:test";
import { nextItem, type ArrowKey } from "./grid-focus.ts";

// Seven pinned in three columns (rows of 3, 3 and 1), then three in the list: items 0–6 tiles, 7–9 rows.
const GRID = { tiles: 7, columns: 3, total: 10 };
const from = (at: number | null, key: ArrowKey) => nextItem(at, key, GRID);

test("from the list itself, any arrow goes to the first item", () => {
  assert.equal(from(null, "ArrowDown"), 0);
  assert.equal(from(null, "ArrowRight"), 0);
});

test("←/→ move along the grid and stop at its ends; in the list they move nothing", () => {
  assert.deepEqual([from(1, "ArrowRight"), from(2, "ArrowRight"), from(6, "ArrowRight")], [2, 3, 6]);
  assert.deepEqual([from(1, "ArrowLeft"), from(0, "ArrowLeft")], [0, 0]);
  assert.deepEqual([from(8, "ArrowLeft"), from(8, "ArrowRight")], [null, null]);
});

test("↓ moves a grid row at a time, onto the short last row's tile, then into the list", () => {
  assert.equal(from(1, "ArrowDown"), 4, "the tile below");
  assert.equal(from(4, "ArrowDown"), 6, "nothing right below: the last row's last tile");
  assert.equal(from(6, "ArrowDown"), 7, "from the last row, the list's first row");
  assert.equal(from(8, "ArrowDown"), 9);
  assert.equal(from(9, "ArrowDown"), 9, "the last row stays");
});

test("↑ moves a grid row at a time and stays on the first; from the list's first row it goes back to the grid's last row", () => {
  assert.deepEqual([from(4, "ArrowUp"), from(1, "ArrowUp")], [1, 1]);
  assert.equal(from(7, "ArrowUp"), 6);
  assert.equal(from(9, "ArrowUp"), 8);
});

test("with no pins, ↑/↓ walk the list as before; with nothing at all, nothing moves", () => {
  const list = { tiles: 0, columns: 3, total: 3 };
  assert.deepEqual([nextItem(0, "ArrowDown", list), nextItem(0, "ArrowUp", list), nextItem(2, "ArrowDown", list)], [1, 0, 2]);
  assert.equal(nextItem(null, "ArrowDown", { tiles: 0, columns: 1, total: 0 }), null);
});

test("pins alone: ↓ from the last grid row stays on its tile", () => {
  assert.equal(nextItem(4, "ArrowDown", { tiles: 5, columns: 3, total: 5 }), 4);
});

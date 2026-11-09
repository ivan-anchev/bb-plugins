import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { diffRowsOf, rowIndexOf, type DiffRow } from "./diff-rows.ts";
import type { DiffFile } from "./diff-schema.ts";
import { parsePrDiff } from "./parse-pr-diff.ts";

const fixture = (name: string) => parsePrDiff(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));

// A file of 30 lines where the head removes line 5 and adds two lines after line 20.
const SHIFTED: DiffFile = {
  path: "src/shifted.ts",
  previousPath: null,
  status: "modified",
  binary: false,
  hunks: [
    { oldStart: 4, oldLines: 3, newStart: 4, newLines: 2, lines: [" line 4", "-line 5", " line 6"] },
    { oldStart: 20, oldLines: 2, newStart: 19, newLines: 4, lines: [" line 20", "+new a", "+new b", " line 21"] },
  ],
};
const SHIFTED_NEW = [...range(1, 4), ...range(6, 20), "new a", "new b", ...range(21, 30)].join("\n") + "\n";

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`);
}

const numbers = (rows: DiffRow[]) => rows.map((row) => `${row.old ?? "·"}/${row.new ?? "·"}`);

test("without the file's text, the rows are the hunks' lines, numbered on each side they are on", () => {
  const rows = diffRowsOf(SHIFTED, null);

  assert.deepEqual(numbers(rows), ["4/4", "5/·", "6/5", "20/19", "·/20", "·/21", "21/22"]);
  assert.deepEqual(
    rows.map((row) => [row.kind, row.hunk, row.text]),
    [
      ["unchanged", 0, " line 4"],
      ["removed", 0, "-line 5"],
      ["unchanged", 0, " line 6"],
      ["unchanged", 1, " line 20"],
      ["added", 1, "+new a"],
      ["added", 1, "+new b"],
      ["unchanged", 1, " line 21"],
    ],
  );
});

test("with the file's text, the unchanged lines around the hunks are rows outside every hunk, with their old numbers", () => {
  const rows = diffRowsOf(SHIFTED, SHIFTED_NEW);

  assert.equal(rows.length, 32, "the 31 new lines and the removed one, each once");
  assert.deepEqual(rows[0], { kind: "unchanged", old: 1, new: 1, text: " line 1", hunk: null });
  assert.deepEqual(rows[6], { kind: "unchanged", old: 7, new: 6, text: " line 7", hunk: null }, "one line up after the removal");
  assert.deepEqual(rows[23], { kind: "unchanged", old: 22, new: 23, text: " line 22", hunk: null }, "one line down after the hunks");
  assert.deepEqual(rows.at(-1), { kind: "unchanged", old: 30, new: 31, text: " line 30", hunk: null });
  assert.deepEqual(
    rows.filter((row) => row.hunk !== null),
    diffRowsOf(SHIFTED, null),
  );
});

test("the no-newline marker is on neither side, so it is not a row", () => {
  const [file] = fixture("no-newline.diff");

  assert.deepEqual(
    diffRowsOf(file, null).map((row) => row.text),
    [" line", "-end", "+end", "+more"],
  );
});

test("a context line is found from either of its numbers, a changed line only from its own side", () => {
  const rows = diffRowsOf(SHIFTED, null);

  assert.equal(rowIndexOf(rows, "old", 6), 2);
  assert.equal(rowIndexOf(rows, "new", 5), 2);
  assert.equal(rowIndexOf(rows, "old", 5), 1);
  assert.throws(() => rowIndexOf(rows, "new", 1), /No drawn row has line 1 on the new side/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRowsOf } from "../diff/diff-rows.ts";
import type { DiffFile } from "../diff/diff-schema.ts";
import { inOneHunk, linesLabel, quoteOf, refOf, spanBetween } from "./line-span.ts";

const PATH = " src/odd\tname.ts ";
const COMMIT = "3f9c2ab";

// Two hunks: the first changes line 3, the second adds a line after line 20.
const FILE: DiffFile = {
  path: PATH,
  previousPath: null,
  status: "modified",
  binary: false,
  hunks: [
    { oldStart: 2, oldLines: 3, newStart: 2, newLines: 3, lines: [" line 2", "-line 3", "+THREE", " line 4"] },
    { oldStart: 20, oldLines: 1, newStart: 20, newLines: 2, lines: [" line 20", "+twenty b"] },
  ],
};
const NEW_CONTENT = Array.from({ length: 21 }, (_, index) => (index === 2 ? "THREE" : index === 20 ? "twenty b" : `line ${index + 1}`)).join("\n") + "\n";
const ROWS = diffRowsOf(FILE, null);

test("a context line picked on the old side, as split view's left column reports it, anchors to the new side", () => {
  const span = spanBetween(PATH, COMMIT, ROWS, { side: "old", line: 4 }, { side: "old", line: 4 });

  assert.deepEqual(span.rows.map(refOf), [{ side: "new", line: 4 }]);
});

test("an upward drag gives the same rows, in diff order", () => {
  const down = spanBetween(PATH, COMMIT, ROWS, { side: "new", line: 2 }, { side: "new", line: 4 });
  const up = spanBetween(PATH, COMMIT, ROWS, { side: "new", line: 4 }, { side: "new", line: 2 });

  assert.deepEqual(up, down);
  assert.deepEqual(
    up.rows.map((row) => row.text),
    [" line 2", "-line 3", "+THREE", " line 4"],
  );
});

test("a span from a removed line to an added line runs across both sides", () => {
  const span = spanBetween(PATH, COMMIT, ROWS, { side: "old", line: 3 }, { side: "new", line: 3 });
  const quote = quoteOf(span);

  assert.deepEqual([quote.start, quote.end], [{ side: "old", line: 3 }, { side: "new", line: 3 }]);
  assert.equal(linesLabel(quote.start, quote.end), "line 3 (old) to line 3 (new)");
});

test("lines are in one hunk only when every row is in the same hunk of the PR", () => {
  const rows = diffRowsOf(FILE, NEW_CONTENT);

  assert.equal(inOneHunk(spanBetween(PATH, COMMIT, rows, { side: "new", line: 2 }, { side: "new", line: 4 })), true);
  assert.equal(inOneHunk(spanBetween(PATH, COMMIT, rows, { side: "new", line: 4 }, { side: "new", line: 20 })), false, "across hunks");
  assert.equal(inOneHunk(spanBetween(PATH, COMMIT, rows, { side: "new", line: 1 }, { side: "new", line: 2 })), false, "from an expanded line");
  assert.equal(inOneHunk(spanBetween(PATH, COMMIT, rows, { side: "new", line: 10 }, { side: "new", line: 10 })), false, "an expanded line alone");
});

test("the quote keeps the exact path and the commit, and each line with its diff prefix", () => {
  const quote = quoteOf(spanBetween(PATH, COMMIT, ROWS, { side: "new", line: 4 }, { side: "new", line: 2 }));

  assert.deepEqual(quote, {
    path: PATH,
    commit: COMMIT,
    start: { side: "new", line: 2 },
    end: { side: "new", line: 4 },
    lines: [" line 2", "-line 3", "+THREE", " line 4"],
  });
});

test("the label names one line, a run on one side, or the two ends on their sides", () => {
  assert.equal(linesLabel({ side: "new", line: 12 }, { side: "new", line: 12 }), "line 12 (new)");
  assert.equal(linesLabel({ side: "old", line: 26 }, { side: "old", line: 31 }), "lines 26–31 (old)");
  assert.equal(linesLabel({ side: "old", line: 26 }, { side: "new", line: 63 }), "line 26 (old) to line 63 (new)");
});

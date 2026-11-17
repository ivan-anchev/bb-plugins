import assert from "node:assert/strict";
import { test } from "node:test";
import { fileIndexAt } from "./current-file.ts";

test("the reader is on the last file that starts at or above their line", () => {
  const tops = [0, 300, 320, 1200];

  assert.deepEqual(
    [0, 299, 300, 319, 320, 1199, 1200, 9000].map((line) => fileIndexAt(tops, line)),
    [0, 0, 1, 1, 2, 2, 3, 3],
  );
});

test("above the first file's top, the reader is on the first file", () => {
  assert.equal(fileIndexAt([8, 400], 0), 0);
});

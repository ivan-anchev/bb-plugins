import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRange } from "./range.ts";

const SIZE = 1_000;

test("no Range header asks for the whole file", () => {
  assert.deepEqual(parseRange(undefined, SIZE), { kind: "whole" });
});

test("a closed range is the bytes it names, cut at the end of the file", () => {
  assert.deepEqual(parseRange("bytes=0-1023", 16_089_732), { kind: "part", start: 0, end: 1023 });
  assert.deepEqual(parseRange("bytes=100-199", SIZE), { kind: "part", start: 100, end: 199 });
  assert.deepEqual(parseRange("bytes=900-5000", SIZE), { kind: "part", start: 900, end: 999 });
});

test("an open range runs to the end of the file, as a browser asks when it seeks", () => {
  assert.deepEqual(parseRange("bytes=0-", SIZE), { kind: "part", start: 0, end: 999 });
  assert.deepEqual(parseRange("bytes=600-", SIZE), { kind: "part", start: 600, end: 999 });
});

test("a suffix range is the last bytes, or the whole file when it is shorter", () => {
  assert.deepEqual(parseRange("bytes=-100", SIZE), { kind: "part", start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-5000", SIZE), { kind: "part", start: 0, end: 999 });
});

test("a range that starts past the end, or an empty suffix, cannot be served", () => {
  assert.deepEqual(parseRange("bytes=1000-", SIZE), { kind: "unsatisfiable" });
  assert.deepEqual(parseRange("bytes=2000-3000", SIZE), { kind: "unsatisfiable" });
  assert.deepEqual(parseRange("bytes=-0", SIZE), { kind: "unsatisfiable" });
});

test("a malformed, backwards or multi-part range is ignored, so the whole file is sent", () => {
  for (const header of ["bytes=-", "bytes=5-3", "bytes=0-1,5-9", "items=0-10", "bytes=a-b", ""]) {
    assert.deepEqual(parseRange(header, SIZE), { kind: "whole" }, header);
  }
});

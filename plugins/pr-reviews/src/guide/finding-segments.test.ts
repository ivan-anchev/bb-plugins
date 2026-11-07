import assert from "node:assert/strict";
import { test } from "node:test";
import { hunkIdOf, type Hunk } from "../diff/diff-schema.ts";
import { hunkToPatch } from "../diff/hunk-patch.ts";
import { interleaveFindings, type Segment } from "./finding-segments.ts";
import type { Finding } from "./guide-schema.ts";
import type { VisibleFinding } from "./walkthrough.ts";

// Old lines 20-22, new lines 20-22: a context line, a replaced line, a context line.
const HUNK: Hunk = { oldStart: 20, oldLines: 3, newStart: 20, newLines: 3, lines: [" keep", "-before", "+after", " tail"] };

const on = (index: number, side: Finding["side"], line: number): VisibleFinding => ({
  index,
  finding: { file: "src/a.ts", line, side, hunk: hunkIdOf(HUNK), priority: "p1", title: `Finding ${index}`, body: "…" },
});

// Each code segment as its patch, each finding as its index: what the step draws, in order.
const drawn = (segments: Segment[]) => segments.map((segment) => (segment.kind === "code" ? hunkToPatch(segment.hunk) : segment.finding.index));

test("with no findings the hunk is one segment, unsplit", () => {
  assert.deepEqual(interleaveFindings(HUNK, []), [{ kind: "code", hunk: HUNK }]);
});

test("two findings on one line sit together under it, in submission order, whatever the order cuts arrive", () => {
  assert.deepEqual(drawn(interleaveFindings(HUNK, [on(4, "new", 22), on(0, "new", 21), on(1, "new", 21)])), [
    "@@ -20,2 +20,2 @@\n keep\n-before\n+after\n",
    0,
    1,
    "@@ -22,1 +22,1 @@\n tail\n",
    4,
  ]);
});

test("a finding on a removed line sits under its -/+ pair, which stays whole", () => {
  assert.deepEqual(drawn(interleaveFindings(HUNK, [on(0, "old", 21)])), ["@@ -20,2 +20,2 @@\n keep\n-before\n+after\n", 0, "@@ -22,1 +22,1 @@\n tail\n"]);
});

test("a finding on the first line follows it, and one on the last line ends the hunk with no empty tail", () => {
  assert.deepEqual(drawn(interleaveFindings(HUNK, [on(0, "new", 20), on(1, "new", 22)])), [
    "@@ -20,1 +20,1 @@\n keep\n",
    0,
    "@@ -21,2 +21,2 @@\n-before\n+after\n tail\n",
    1,
  ]);
});

test("a finding on a line the hunk does not hold fails loudly", () => {
  assert.throws(() => interleaveFindings(HUNK, [on(0, "new", 40)]), /new line 40, which is not in its hunk/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Hunk } from "./diff-schema.ts";
import { cutAfter, hunkToPatch, sliceHunk } from "./hunk-patch.ts";
import { parsePrDiff } from "./parse-pr-diff.ts";

const readFixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

// The fixture's text from a hunk's header to the end of the file: what the patch must reproduce.
const textFrom = (fixture: string, header: string) => fixture.slice(fixture.indexOf(header));

test("a hunk becomes its own text in the diff, from its header on", () => {
  const fixture = readFixture("github-pr.diff");
  const file = parsePrDiff(fixture).find((candidate) => candidate.path === "plugins/code-explorer/src/ui/segment-keys.ts");
  assert.ok(file);

  assert.equal(hunkToPatch(file.hunks[0]), textFrom(fixture, "@@ -1,8 +1,10 @@"));
});

test("the header is written in canonical form, without git's trailing context", () => {
  const fixture = readFixture("github-pr.diff");
  const [file] = parsePrDiff(fixture);
  const body = fixture.slice(fixture.indexOf("\n", fixture.indexOf("@@ -13,13")) + 1, fixture.indexOf("diff --git", 1));

  assert.equal(hunkToPatch(file.hunks[0]), `@@ -13,13 +13,18 @@\n${body}`);
});

test("a no-newline marker stays under its line", () => {
  const fixture = readFixture("no-newline.diff");
  const [file] = parsePrDiff(fixture);

  assert.equal(hunkToPatch(file.hunks[0]), textFrom(fixture, "@@ -1,2 +1,3 @@"));
});

// ---- slicing a hunk at a finding ----

const hunk = (header: [number, number, number, number], lines: string[]): Hunk => {
  const [oldStart, oldLines, newStart, newLines] = header;
  return { oldStart, oldLines, newStart, newLines, lines };
};

/** The hunk cut at each of `cuts`, as the patches experimental_Diff draws. */
const patchesOf = (whole: Hunk, cuts: number[]) =>
  [0, ...cuts].map((from, i) => hunkToPatch(sliceHunk(whole, from, cuts[i] ?? whole.lines.length)));

const REPLACED = hunk([10, 2, 10, 2], ["-oldA", "-oldB", "+newA", "+newB"]);

test("a slice after a removed line numbers both halves from where each side stands", () => {
  // Old line 10 is the hunk's first line.
  assert.deepEqual(patchesOf(REPLACED, [1]), ["@@ -10,1 +9,0 @@\n-oldA\n", "@@ -11,1 +10,2 @@\n-oldB\n+newA\n+newB\n"]);
});

test("a second slice, after new line 10, leaves an empty old side starting one line back", () => {
  // New line 10 is "+newA", the hunk's third line.
  assert.deepEqual(patchesOf(REPLACED, [1, 3]), [
    "@@ -10,1 +9,0 @@\n-oldA\n",
    "@@ -11,1 +10,1 @@\n-oldB\n+newA\n",
    "@@ -11,0 +11,1 @@\n+newB\n",
  ]);
});

test("a no-newline marker is not counted as a line of either side", () => {
  const whole = hunk([1, 2, 1, 2], [" a", "-b", "\\ No newline at end of file", "+b"]);

  assert.deepEqual(patchesOf(whole, [3]), ["@@ -1,2 +1,1 @@\n a\n-b\n\\ No newline at end of file\n", "@@ -2,0 +2,1 @@\n+b\n"]);
});

test("a cut after a removed line followed by added lines comes after the whole -/+ run, so the pair keeps its word highlighting", () => {
  assert.equal(cutAfter(REPLACED, 0), 4);
  assert.equal(cutAfter(REPLACED, 1), 4);
});

test("a cut after a removed line followed by context, or after an added line, comes right after that line", () => {
  assert.equal(cutAfter(hunk([1, 3, 1, 1], ["-a", "-b", " c"]), 0), 1);
  assert.equal(cutAfter(REPLACED, 2), 3);
});

test("no-newline markers inside a -/+ run stay in the run", () => {
  const whole = hunk([1, 2, 1, 2], [" a", "-b", "\\ No newline at end of file", "+B", "\\ No newline at end of file"]);

  assert.equal(cutAfter(whole, 1), 5);
});

test("a cut on the last line leaves no tail", () => {
  const whole = hunk([4, 3, 4, 3], [" a", "-b", "+B", " c"]);
  const cut = cutAfter(whole, 3);

  assert.equal(cut, whole.lines.length);
  assert.deepEqual(sliceHunk(whole, 0, cut), whole);
});

test("a cut on an added line followed by the no-newline marker keeps the marker with its line", () => {
  assert.equal(cutAfter(hunk([1, 1, 1, 2], [" a", "+b", "\\ No newline at end of file"]), 1), 3);
});

test("a hunk with an empty side, as in a new file, keeps that side empty in every slice", () => {
  const added = hunk([0, 0, 1, 3], ["+a", "+b", "+c"]);

  assert.deepEqual(patchesOf(added, [cutAfter(added, 0)]), ["@@ -0,0 +1,1 @@\n+a\n", "@@ -0,0 +2,2 @@\n+b\n+c\n"]);
});

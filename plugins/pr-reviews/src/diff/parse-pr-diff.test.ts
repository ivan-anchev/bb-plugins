import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { unitIdsOf, type DiffFile } from "./diff-schema.ts";
import { parsePrDiff } from "./parse-pr-diff.ts";

// Each fixture is real `git diff` output, except github-pr.diff, which is `gh pr diff` output.
const parseFixture = (name: string) => parsePrDiff(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));

// What the prompt and the guide read of a file: who it is and the units it must place.
const summary = (file: DiffFile) => ({
  path: file.path,
  previousPath: file.previousPath,
  status: file.status,
  binary: file.binary,
  units: unitIdsOf(file),
});

test("a modified file has one unit per hunk, in canonical form", () => {
  assert.deepEqual(parseFixture("modified.diff").map(summary), [
    { path: "mod.txt", previousPath: null, status: "modified", binary: false, units: ["@@ -1,5 +1,5 @@", "@@ -11,5 +11,5 @@"] },
  ]);
});

test("GitHub's diff of a PR parses the same way", () => {
  assert.deepEqual(parseFixture("github-pr.diff").map(summary), [
    { path: "plugins/code-explorer/src/ui/segment-keys.test.ts", previousPath: null, status: "modified", binary: false, units: ["@@ -13,13 +13,18 @@"] },
    { path: "plugins/code-explorer/src/ui/segment-keys.ts", previousPath: null, status: "modified", binary: false, units: ["@@ -1,8 +1,10 @@"] },
  ]);
});

test("an added file keeps git's zero start; an empty one is a whole-file unit", () => {
  assert.deepEqual(parseFixture("added.diff").map(summary), [
    { path: "add.txt", previousPath: null, status: "added", binary: false, units: ["@@ -0,0 +1,2 @@"] },
    { path: "empty.txt", previousPath: null, status: "added", binary: false, units: ["whole file"] },
  ]);
});

test("a deleted file is named by its old path", () => {
  assert.deepEqual(parseFixture("deleted.diff").map(summary), [
    { path: "del.txt", previousPath: null, status: "deleted", binary: false, units: ["@@ -1,2 +0,0 @@"] },
  ]);
});

test("a rename keeps its old path; a pure rename is a whole-file unit", () => {
  assert.deepEqual(parseFixture("renamed.diff").map(summary), [
    { path: "new-name.txt", previousPath: "old-name.txt", status: "renamed", binary: false, units: ["@@ -3,6 +3,6 @@"] },
    { path: "moved.txt", previousPath: "keep.txt", status: "renamed", binary: false, units: ["whole file"] },
  ]);
});

test("a binary file is a whole-file unit", () => {
  assert.deepEqual(parseFixture("binary.diff").map(summary), [
    { path: "img.bin", previousPath: null, status: "modified", binary: true, units: ["whole file"] },
  ]);
});

test("the no-newline marker stays in the hunk's lines", () => {
  const [file] = parseFixture("no-newline.diff");
  assert.deepEqual(file?.hunks.map((hunk) => hunk.lines), [
    [" line", "-end", "\\ No newline at end of file", "+end", "+more", "\\ No newline at end of file"],
  ]);
});

test("a C-quoted path is unquoted", () => {
  assert.deepEqual(parseFixture("quoted-path.diff").map(summary), [
    { path: "café x.txt", previousPath: null, status: "modified", binary: false, units: ["@@ -1,1 +1,2 @@"] },
  ]);
});

test("a truncated hunk throws", () => {
  assert.throws(() => parseFixture("truncated.diff"), Error);
});

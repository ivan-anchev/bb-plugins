import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filePatchOf, hunkToPatch } from "./hunk-patch.ts";
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

test("a file's patch is each of its hunks in order", () => {
  const [file] = parsePrDiff(readFixture("modified.diff"));

  assert.equal(
    filePatchOf(file),
    ["@@ -1,5 +1,5 @@", " one", "-two", "+TWO", " three", " four", " five", "@@ -11,5 +11,5 @@", " eleven", " twelve", " thirteen", "-fourteen", "+FOURTEEN", " fifteen", ""].join("\n"),
  );
});

test("a file with no text hunks has an empty patch", () => {
  const [file] = parsePrDiff(readFixture("binary.diff"));

  assert.equal(filePatchOf(file), "");
});

test("a no-newline marker stays under its line", () => {
  const fixture = readFixture("no-newline.diff");
  const [file] = parsePrDiff(fixture);

  assert.equal(hunkToPatch(file.hunks[0]), textFrom(fixture, "@@ -1,2 +1,3 @@"));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { parsePrDiff } from "../../diff/parse-pr-diff.ts";
import { fileDiffOf } from "./diff-options.ts";

const fixture = (name: string) => parsePrDiff(readFileSync(new URL(`../../diff/fixtures/${name}`, import.meta.url), "utf8"));

const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"];
const MODIFIED_NEW = NUMBERS.map((word) => (word === "two" || word === "fourteen" ? word.toUpperCase() : word)).join("\n") + "\n";

test("before the file's text is read, the diff is the patch alone, with nothing to expand", () => {
  const [file] = fixture("modified.diff");
  const diff = fileDiffOf(file, null);

  assert.deepEqual([diff.name, diff.type, diff.isPartial, diff.hunks.length], ["mod.txt", "change", true, 2]);
});

test("with the file's text, both whole sides come in, so the unchanged lines can expand", () => {
  const [file] = fixture("modified.diff");
  const diff = fileDiffOf(file, MODIFIED_NEW);

  assert.deepEqual([diff.type, diff.isPartial, diff.hunks.length], ["change", false, 2]);
  assert.equal(diff.deletionLines.join(""), MODIFIED_NEW.replace("TWO", "two").replace("FOURTEEN", "fourteen"));
});

test("a renamed file is named by its new path on both sides, so the diff reads as a change, not a rename", () => {
  const [file] = fixture("renamed.diff");
  const diff = fileDiffOf(file, null);

  assert.deepEqual([diff.name, diff.prevName, diff.type], ["new-name.txt", undefined, "change"]);
});

// The new side of a fixture whose one hunk starts the file and runs to its end.
const newSideOf = (file: DiffFile) =>
  file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line[0] !== "-").map((line) => line.slice(1))).join("\n") + "\n";

test("Pierre names each file by its exact path, whatever bytes the path holds, before and after its text is read", () => {
  const unusual = ["space-paths.diff", "escaped-path.diff", "quoted-path.diff", "hidden-path.diff", "line-separator-paths.diff"];
  const files = unusual.flatMap(fixture).filter((file) => file.hunks.length > 0);
  assert.ok(files.some((file) => file.path.includes("\t")), "the fixtures hold a path with a tab");

  for (const file of files) {
    for (const diff of [fileDiffOf(file, null), fileDiffOf(file, newSideOf(file))]) {
      assert.deepEqual([diff.name, diff.prevName, diff.type], [file.path, undefined, "change"], JSON.stringify(file.path));
    }
  }
});

test("an added or a deleted file keeps /dev/null as its missing side, read whole or as a patch", () => {
  const [added] = fixture("added.diff");
  const [deleted] = fixture("deleted.diff");

  for (const file of [added, deleted]) {
    const content = file === added ? newSideOf(file) : "";
    for (const diff of [fileDiffOf(file, null), fileDiffOf(file, content)]) {
      assert.deepEqual([diff.name, diff.prevName], [file.path, undefined]);
    }
  }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { oldContentOf } from "./old-content.ts";
import { parsePrDiff } from "./parse-pr-diff.ts";

// Each case diffs a real file with git, staged old against its new text in the work tree, then
// rebuilds the old text from the new one and the diff.
const root = mkdtempSync(join(tmpdir(), "pr-reviews-old-content-"));
after(() => rmSync(root, { recursive: true, force: true }));
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
git("init", "--quiet");

function rebuilt(oldContent: string, newContent: string): string {
  const path = join(root, "file.txt");
  writeFileSync(path, oldContent);
  git("add", "file.txt");
  writeFileSync(path, newContent);
  const [file] = parsePrDiff(git("diff", "--no-color", "--", "file.txt"));
  return oldContentOf(file, newContent);
}

const lines = (count: number, edit: (line: string, index: number) => string = (line) => line) =>
  Array.from({ length: count }, (_, index) => edit(`line ${index + 1}`, index)).join("\n") + "\n";

test("the lines between and around hunks come from the new side", () => {
  const oldContent = lines(40);
  const newContent = lines(40, (line, index) => (index === 4 || index === 30 ? `${line} changed` : line));

  assert.equal(rebuilt(oldContent, newContent), oldContent);
});

test("added and removed lines shift the rest of the file", () => {
  const oldContent = lines(30);
  const newContent = oldContent.replace("line 3\n", "line 3\nnew a\nnew b\n").replace("line 21\n", "");

  assert.equal(rebuilt(oldContent, newContent), oldContent);
});

test("a change at the very start and at the very end", () => {
  const oldContent = lines(20);
  const newContent = `first\n${lines(20).replace("line 20\n", "line twenty\n")}`;

  assert.equal(rebuilt(oldContent, newContent), oldContent);
});

test("an old side without a final newline", () => {
  assert.equal(rebuilt("line\nend", "line\nend\nmore"), "line\nend");
});

test("a new side without a final newline", () => {
  assert.equal(rebuilt(lines(12), lines(12).replace(/\n$/, "")), lines(12));
});

test("neither side ends in a newline, with the end unchanged", () => {
  const oldContent = lines(12).replace(/\n$/, "");
  const newContent = oldContent.replace("line 2\n", "line two\n");

  assert.equal(rebuilt(oldContent, newContent), oldContent);
});

test("carriage returns stay on their lines", () => {
  const oldContent = lines(15).replaceAll("\n", "\r\n");
  const newContent = oldContent.replace("line 8\r\n", "line eight\r\n");

  assert.equal(rebuilt(oldContent, newContent), oldContent);
});

test("a file emptied of every line", () => {
  assert.equal(rebuilt(lines(3), ""), lines(3));
});

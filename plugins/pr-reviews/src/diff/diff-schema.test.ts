import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileLineCountsOf } from "./diff-schema.ts";
import { parsePrDiff } from "./parse-pr-diff.ts";

const filesOf = (name: string) => parsePrDiff(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));

test("a file's line counts add up every hunk's added and removed lines", () => {
  const [file] = filesOf("modified.diff");

  assert.deepEqual(fileLineCountsOf(file), { added: 2, removed: 2 });
});

test("a no-newline marker counts on neither side", () => {
  const [file] = filesOf("no-newline.diff");

  assert.deepEqual(fileLineCountsOf(file), { added: 2, removed: 1 });
});

test("a binary file and a pure rename have no lines", () => {
  const [binary] = filesOf("binary.diff");
  const pureRename = filesOf("renamed.diff")[1];

  assert.deepEqual(fileLineCountsOf(binary), { added: 0, removed: 0 });
  assert.deepEqual(fileLineCountsOf(pureRename), { added: 0, removed: 0 });
});

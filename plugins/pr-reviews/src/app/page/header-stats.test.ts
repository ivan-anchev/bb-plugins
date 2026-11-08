import assert from "node:assert/strict";
import { test } from "node:test";
import { diffBlocks } from "./header-stats.ts";

test("a diffstat splits five blocks in proportion", () => {
  assert.deepEqual(diffBlocks(386, 94), ["added", "added", "added", "added", "removed"]);
  assert.deepEqual(diffBlocks(1145, 0), ["added", "added", "added", "added", "added"]);
  assert.deepEqual(diffBlocks(0, 7), ["removed", "removed", "removed", "removed", "removed"]);
});

test("a PR with no lines has five empty blocks", () => {
  assert.deepEqual(diffBlocks(0, 0), ["empty", "empty", "empty", "empty", "empty"]);
});

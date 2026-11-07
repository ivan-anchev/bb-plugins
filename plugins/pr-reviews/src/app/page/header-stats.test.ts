import assert from "node:assert/strict";
import { test } from "node:test";
import { checksVerdict, diffBlocks } from "./header-stats.ts";

test("a diffstat splits five blocks in proportion", () => {
  assert.deepEqual(diffBlocks(386, 94), ["added", "added", "added", "added", "removed"]);
  assert.deepEqual(diffBlocks(1145, 0), ["added", "added", "added", "added", "added"]);
  assert.deepEqual(diffBlocks(0, 7), ["removed", "removed", "removed", "removed", "removed"]);
});

test("a PR with no lines has five empty blocks", () => {
  assert.deepEqual(diffBlocks(0, 0), ["empty", "empty", "empty", "empty", "empty"]);
});

test("no checks has no verdict", () => {
  assert.equal(checksVerdict({ passing: 0, failing: 0, pending: 0 }), null);
});

test("all passing reads as the passing count", () => {
  assert.deepEqual(checksVerdict({ passing: 2, failing: 0, pending: 0 }), { tone: "passing", headline: "2/2 checks passing", rest: [] });
});

test("failing leads, then pending, then the passing count", () => {
  assert.deepEqual(checksVerdict({ passing: 3, failing: 1, pending: 0 }), { tone: "failing", headline: "1 check failing", rest: ["3/4 passing"] });
  assert.deepEqual(checksVerdict({ passing: 4, failing: 1, pending: 1 }), { tone: "failing", headline: "1 check failing", rest: ["1 pending", "4/6 passing"] });
});

test("pending leads when nothing fails", () => {
  assert.deepEqual(checksVerdict({ passing: 1, failing: 0, pending: 2 }), { tone: "pending", headline: "2 checks pending", rest: ["1/3 passing"] });
});

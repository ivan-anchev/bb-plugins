import assert from "node:assert/strict";
import { test } from "node:test";
import { heirOf } from "./focus.ts";

const before = ["a", "b", "c", "d"];

test("the row that took the gone row's place inherits focus", () => {
  assert.equal(heirOf(before, "b", new Set(["a", "c", "d"])), "c");
});

test("rows that left with it are skipped", () => {
  assert.equal(heirOf(before, "b", new Set(["a", "d"])), "d");
});

test("the last row hands focus to the one above it", () => {
  assert.equal(heirOf(before, "d", new Set(["a", "b"])), "b");
});

test("with no row left, nothing inherits", () => {
  assert.equal(heirOf(before, "b", new Set()), null);
});

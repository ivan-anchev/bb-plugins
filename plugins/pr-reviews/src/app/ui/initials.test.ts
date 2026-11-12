import assert from "node:assert/strict";
import { test } from "node:test";
import { initialsOf } from "./initials.ts";

test("two words give their first letters, one word its first two", () => {
  assert.equal(initialsOf("ivan-anchev"), "IA");
  assert.equal(initialsOf("lena_s"), "LS");
  assert.equal(initialsOf("renovate[bot]"), "RB");
  assert.equal(initialsOf("dependabot"), "DE");
  assert.equal(initialsOf("k"), "K");
});

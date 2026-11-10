import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewThread } from "../../comments/thread-schema.ts";
import { isFolded } from "./thread-fold.ts";

const OPEN: ReviewThread = {
  id: "PRRT_1",
  path: "src/a.ts",
  resolvedBy: null,
  outdated: false,
  subject: { kind: "file" },
  comments: [{ id: 1, url: "https://github.com/o/r/pull/1#discussion_r1", author: { login: "octocat", bot: false }, body: "Why?", createdAt: "2026-11-10T08:00:00Z" }],
};
const RESOLVED: ReviewThread = { ...OPEN, resolvedBy: "octocat" };

test("a resolved thread folds until the reader opens it", () => {
  assert.equal(isFolded(RESOLVED, false), true);
  assert.equal(isFolded(RESOLVED, true), false);
});

test("a resolved thread that GitHub reopens shows open on the next read, though the reader never opened it", () => {
  const expanded = false;
  assert.equal(isFolded(RESOLVED, expanded), true);
  assert.equal(isFolded(OPEN, expanded), false);
});

test("an open thread that GitHub resolves folds on the next read", () => {
  assert.equal(isFolded(OPEN, false), false);
  assert.equal(isFolded(RESOLVED, false), true);
});

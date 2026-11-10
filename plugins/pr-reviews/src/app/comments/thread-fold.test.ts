import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitHubComment, ReviewThread } from "../../comments/thread-schema.ts";
import { foldOf, type Opened } from "./thread-fold.ts";

const comment = (id: number): GitHubComment => ({
  id,
  url: `https://github.com/o/r/pull/1#discussion_r${id}`,
  author: { login: "octocat", bot: false },
  body: `Comment ${id}`,
  createdAt: "2026-11-10T08:00:00Z",
});
const withComments = (thread: ReviewThread, count: number): ReviewThread => ({ ...thread, comments: Array.from({ length: count }, (_, index) => comment(index + 1)) });

const OPEN: ReviewThread = { id: "PRRT_1", path: "src/a.ts", resolvedBy: null, outdated: false, subject: { kind: "file" }, comments: [comment(1)] };
const RESOLVED: ReviewThread = { ...OPEN, resolvedBy: "octocat" };
const NOTHING_OPENED: Opened = { thread: false, middle: false };

test("a resolved thread folds to its row until the reader opens it", () => {
  assert.deepEqual(foldOf(RESOLVED, NOTHING_OPENED), { kind: "row" });
  assert.equal(foldOf(RESOLVED, { thread: true, middle: false }).kind, "comments");
});

test("a resolved thread that GitHub reopens shows open on the next read, though the reader never opened it", () => {
  assert.equal(foldOf(RESOLVED, NOTHING_OPENED).kind, "row");
  assert.equal(foldOf(OPEN, NOTHING_OPENED).kind, "comments");
});

test("an open thread that GitHub resolves folds on the next read", () => {
  assert.equal(foldOf(OPEN, NOTHING_OPENED).kind, "comments");
  assert.equal(foldOf(RESOLVED, NOTHING_OPENED).kind, "row");
});

test("a thread of three comments shows them all", () => {
  const thread = withComments(OPEN, 3);
  assert.deepEqual(foldOf(thread, NOTHING_OPENED), { kind: "comments", shown: thread.comments, hidden: 0 });
});

test("a longer thread shows its first and latest comments, with the rest hidden", () => {
  const thread = withComments(OPEN, 5);
  assert.deepEqual(foldOf(thread, NOTHING_OPENED), { kind: "comments", shown: [thread.comments[0], thread.comments[4]], hidden: 3 });
});

test("a short thread that a refresh grows past three folds on that read, though it was whole before", () => {
  const grown = withComments(OPEN, 5);
  assert.deepEqual(foldOf(OPEN, NOTHING_OPENED), { kind: "comments", shown: OPEN.comments, hidden: 0 });
  assert.deepEqual(foldOf(grown, NOTHING_OPENED), { kind: "comments", shown: [grown.comments[0], grown.comments[4]], hidden: 3 });
});

test("a long thread whose middle the reader opened stays whole as it grows", () => {
  const grown = withComments(OPEN, 6);
  assert.deepEqual(foldOf(grown, { thread: false, middle: true }), { kind: "comments", shown: grown.comments, hidden: 0 });
});

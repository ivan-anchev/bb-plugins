import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRowsOf } from "../diff/diff-rows.ts";
import type { PrDetail } from "../contract.ts";
import { hunkIdOf, type DiffFile } from "../diff/diff-schema.ts";
import type { Finding } from "../guide/guide-schema.ts";
import { GITHUB_BODY_LIMIT, type LineRef } from "./comment-schema.ts";
import { spanBetween } from "./line-span.ts";
import { checkComment, checkReply, findingCommentText, planComment } from "./plan-comment.ts";
import type { ReviewThread } from "./thread-schema.ts";

const PATH = "src/a.ts";
const COMMIT = "3f9c2ab0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6";

// Two hunks: the first changes line 3, the second adds a line after line 20.
const FILE: DiffFile = {
  path: PATH,
  previousPath: null,
  status: "modified",
  binary: false,
  hunks: [
    { oldStart: 2, oldLines: 3, newStart: 2, newLines: 3, lines: [" line 2", "-line 3", "+THREE", " line 4"] },
    { oldStart: 20, oldLines: 1, newStart: 20, newLines: 2, lines: [" line 20", "+twenty b"] },
  ],
};
const NEW_CONTENT = Array.from({ length: 21 }, (_, index) => (index === 2 ? "THREE" : index === 20 ? "twenty b" : `line ${index + 1}`)).join("\n") + "\n";
const ROWS = diffRowsOf(FILE, null);
const EXPANDED_ROWS = diffRowsOf(FILE, NEW_CONTENT);

const spanOf = (a: LineRef, b: LineRef, rows = ROWS, path = PATH) => spanBetween(path, COMMIT, rows, a, b);
const NEW = (line: number): LineRef => ({ side: "new", line });
const OLD = (line: number): LineRef => ({ side: "old", line });

test("one line is a line comment on its side, with no start, and the reader's words trimmed", () => {
  assert.deepEqual(planComment(spanOf(NEW(3), NEW(3)), true, "  Why THREE?\n"), {
    request: { kind: "line", commit: COMMIT, path: PATH, start: null, end: NEW(3), body: "Why THREE?" },
    why: null,
  });
  assert.deepEqual(planComment(spanOf(OLD(3), OLD(3)), true, "Gone?"), {
    request: { kind: "line", commit: COMMIT, path: PATH, start: null, end: OLD(3), body: "Gone?" },
    why: null,
  });
});

test("lines on one side are a line comment from the first to the last", () => {
  const plan = planComment(spanOf(NEW(20), NEW(21)), true, "Two lines");

  assert.deepEqual(plan, { request: { kind: "line", commit: COMMIT, path: PATH, start: NEW(20), end: NEW(21), body: "Two lines" }, why: null });
});

test("a range from a removed line to an added one runs from LEFT to RIGHT", () => {
  const plan = planComment(spanOf(OLD(3), NEW(3)), true, "Renamed");

  assert.deepEqual(plan, { request: { kind: "line", commit: COMMIT, path: PATH, start: OLD(3), end: NEW(3), body: "Renamed" }, why: null });
});

test("lines reaching unchanged lines outside the changes are a file comment that quotes them, and says why", () => {
  const plan = planComment(spanOf(NEW(4), NEW(6), EXPANDED_ROWS), true, "Look here");

  assert.ok(!("blocked" in plan));
  assert.deepEqual(plan.request, {
    kind: "file",
    commit: COMMIT,
    path: PATH,
    body: ["`src/a.ts`, lines 4–6 (new), at 3f9c2ab:", "```diff", " line 4", " line 5", " line 6", "```", "", "Look here"].join("\n"),
  });
  assert.equal(plan.why, "some of these lines are outside the PR's changes");
});

test("lines across two hunks are a file comment too", () => {
  const plan = planComment(spanOf(NEW(4), NEW(20)), true, "Both");

  assert.ok(!("blocked" in plan));
  assert.equal(plan.request.kind, "file");
  assert.match(plan.request.body, /^`src\/a\.ts`, lines 4–20 \(new\), at 3f9c2ab:\n```diff\n line 4\n line 20\n```\n\nBoth$/);
  assert.equal(plan.why, "these lines span more than one hunk");
});

test("a commit no longer in the PR blocks the comment: there is no request to post", () => {
  assert.deepEqual(planComment(spanOf(NEW(3), NEW(3)), false, "Too late"), {
    blocked: "Commit 3f9c2ab is no longer in the PR (force-pushed). To comment on the current code, Refresh and use the Changes tab, or update the guide.",
  });
});

test("the quote's fence is longer than any backtick run in the lines", () => {
  const file: DiffFile = { ...FILE, hunks: [FILE.hunks[0], { oldStart: 20, oldLines: 1, newStart: 20, newLines: 2, lines: [" line 20", "+```` four"] }] };
  const plan = planComment(spanBetween(PATH, COMMIT, diffRowsOf(file, null), NEW(2), NEW(21)), true, "Fenced");

  assert.ok(!("blocked" in plan));
  assert.match(plan.request.body, /\n`````diff\n[^]*\+```` four\n`````\n\nFenced$/);
});

test("a path with a backtick, or an edge space, keeps its characters in the inline code", () => {
  const body = (path: string) => {
    const plan = planComment(spanOf(NEW(4), NEW(20), ROWS, path), true, "x");
    assert.ok(!("blocked" in plan));
    return plan.request.body.split("\n")[0];
  };

  assert.equal(body("src/we`ird.ts"), "`` src/we`ird.ts ``, lines 4–20 (new), at 3f9c2ab:");
  assert.equal(body(" spaced.ts"), "`  spaced.ts `, lines 4–20 (new), at 3f9c2ab:");
});

test("a finding's line is one row, and its comment is its bold title over its body", () => {
  const finding: Finding = { file: PATH, line: 3, side: "old", hunk: hunkIdOf(FILE.hunks[0]), priority: "p1", title: "Removed line", body: "Line 3 *mattered*." };
  const text = findingCommentText(finding);

  assert.equal(text, "**Removed line**\n\nLine 3 *mattered*.");
  assert.deepEqual(planComment(spanOf(OLD(3), OLD(3)), true, text), {
    request: { kind: "line", commit: COMMIT, path: PATH, start: null, end: OLD(3), body: "**Removed line**\n\nLine 3 *mattered*." },
    why: null,
  });
});

const LATER = "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b";
const prAt = (commits: string[]): PrDetail => ({
  number: 23,
  title: "Fixture",
  author: "ivan-anchev",
  updatedAt: "2026-11-10T09:00:00Z",
  headSha: commits[commits.length - 1],
  body: "",
  url: "https://github.com/ivan-anchev/bb-plugins/pull/23",
  headRefName: "fixture",
  baseRefName: "main",
  state: "OPEN",
  commits,
  additions: 1, deletions: 1, checks: [], reviewers: [], labels: [],
});

test("a line comment on the PR's latest commit says nothing about where it goes: that is obvious", () => {
  assert.deepEqual(checkComment(spanOf(NEW(3), NEW(3)), prAt([COMMIT]), "Why?"), {
    request: { kind: "line", commit: COMMIT, path: PATH, start: null, end: NEW(3), body: "Why?" },
    note: null,
  });
});

test("a comment on an older commit than the PR's latest says so", () => {
  const check = checkComment(spanOf(NEW(3), NEW(3)), prAt([COMMIT, LATER]), "Why?");

  assert.ok(!("blocked" in check));
  assert.equal(check.note, "Comments on commit 3f9c2ab, not the latest.");
});

test("a file comment says so and why, after the commit when that is older too", () => {
  const latest = checkComment(spanOf(NEW(4), NEW(20)), prAt([COMMIT]), "Both");
  const older = checkComment(spanOf(NEW(4), NEW(6), EXPANDED_ROWS), prAt([COMMIT, LATER]), "Look");

  assert.ok(!("blocked" in latest) && !("blocked" in older));
  assert.equal(latest.note, "Posts as a file comment: these lines span more than one hunk.");
  assert.equal(older.note, "Comments on commit 3f9c2ab, not the latest. Posts as a file comment: some of these lines are outside the PR's changes.");
});

test("a commit gone from the PR blocks the comment with the reload message", () => {
  assert.deepEqual(checkComment(spanOf(NEW(3), NEW(3)), prAt([LATER]), "Too late"), {
    blocked: "Commit 3f9c2ab is no longer in the PR (force-pushed). To comment on the current code, Refresh and use the Changes tab, or update the guide.",
  });
});

test("a body over GitHub's limit blocks the comment and says by how much, the quote of a file comment counted", () => {
  const atLimit = checkComment(spanOf(NEW(3), NEW(3)), prAt([COMMIT]), "x".repeat(GITHUB_BODY_LIMIT));
  const quoted = checkComment(spanOf(NEW(4), NEW(20)), prAt([COMMIT]), "x".repeat(GITHUB_BODY_LIMIT));

  assert.ok(!("blocked" in atLimit));
  assert.ok("blocked" in quoted);
  assert.deepEqual(quoted, { blocked: "This comment is 65,608 characters, and GitHub takes at most 65,536. Shorten it, or select fewer lines." });
});

const THREAD: ReviewThread = {
  id: "PRRT_1",
  path: PATH,
  resolved: false,
  outdated: false,
  subject: { kind: "file" },
  comments: [
    { id: 41, url: "https://github.com/o/r/pull/1#discussion_r41", author: "octocat", body: "Why?", createdAt: "2026-11-10T08:00:00Z" },
    { id: 42, url: "https://github.com/o/r/pull/1#discussion_r42", author: "hubot", body: "Because.", createdAt: "2026-11-10T09:00:00Z" },
  ],
};

test("a reply goes to the thread's first comment, with the reader's words trimmed", () => {
  assert.deepEqual(checkReply(THREAD, "\n> Because.\n\nAgreed. \n"), { request: { commentId: 41, body: "> Because.\n\nAgreed." } });
});

test("a reply over GitHub's limit is blocked, not sent", () => {
  assert.deepEqual(checkReply(THREAD, "x".repeat(GITHUB_BODY_LIMIT + 1)), { blocked: "This comment is 65,537 characters, and GitHub takes at most 65,536. Shorten it." });
});

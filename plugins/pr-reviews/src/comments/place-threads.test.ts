import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRowsOf } from "../diff/diff-rows.ts";
import type { DiffFile } from "../diff/diff-schema.ts";
import type { LineRef } from "./comment-schema.ts";
import { placeThreads, threadsOfHunk } from "./place-threads.ts";
import type { LineAnchor, ReviewThread } from "./thread-schema.ts";

const PATH = "src/shifted.ts";
const HEAD = "b".repeat(40);
const OLDER = "a".repeat(40);

// The head removes line 5 and adds two lines after line 20: rows 4/4, 5/·, 6/5 in hunk 0 and
// 20/19, ·/20, ·/21, 21/22 in hunk 1.
const FILE: DiffFile = {
  path: PATH,
  previousPath: null,
  status: "modified",
  binary: false,
  hunks: [
    { oldStart: 4, oldLines: 3, newStart: 4, newLines: 2, lines: [" line 4", "-line 5", " line 6"] },
    { oldStart: 20, oldLines: 2, newStart: 19, newLines: 4, lines: [" line 20", "+new a", "+new b", " line 21"] },
  ],
};
const ROWS = diffRowsOf(FILE, null);

const ref = (side: LineRef["side"], line: number): LineRef => ({ side, line });
const at = (commit: string, end: LineRef, start: LineRef | null = null): LineAnchor => ({ commit, start, end });

let nextId = 0;
function thread(subject: ReviewThread["subject"], { path = PATH, outdated = false } = {}): ReviewThread {
  const id = ++nextId;
  return { id: `PRRT_${id}`, path, resolved: false, outdated, subject, comments: [{ id, url: `https://github.com/o/r/pull/1#discussion_r${id}`, author: "octocat", body: "Why?", createdAt: "2026-11-10T08:00:00Z" }] };
}
const onLines = (...anchors: LineAnchor[]) => ({ kind: "lines" as const, anchors });

test("a thread at this commit goes under the row of its last line, on that row's hunk", () => {
  const added = thread(onLines(at(HEAD, ref("new", 21))));
  const removed = thread(onLines(at(HEAD, ref("old", 5))));
  const range = thread(onLines(at(HEAD, ref("new", 22), ref("old", 20))));

  assert.deepEqual(placeThreads([added, removed, range], PATH, HEAD, ROWS), {
    lines: [
      { thread: added, at: ref("new", 21), hunk: 1, lines: at(HEAD, ref("new", 21)) },
      { thread: removed, at: ref("old", 5), hunk: 0, lines: at(HEAD, ref("old", 5)) },
      { thread: range, at: ref("new", 22), hunk: 1, lines: at(HEAD, ref("new", 22), ref("old", 20)) },
    ],
    file: [],
  });
});

test("a thread on the old side of an unchanged line goes under that row, anchored as the diff draws it", () => {
  const leftColumn = thread(onLines(at(HEAD, ref("old", 6))));

  assert.deepEqual(placeThreads([leftColumn], PATH, HEAD, ROWS).lines, [{ thread: leftColumn, at: ref("new", 5), hunk: 0, lines: at(HEAD, ref("old", 6)) }]);
});

test("a diff at the commit a thread was written on places it by the lines it was written on", () => {
  const moved = thread(onLines(at(HEAD, ref("new", 22)), at(OLDER, ref("new", 20))));

  assert.deepEqual(placeThreads([moved], PATH, OLDER, ROWS).lines, [{ thread: moved, at: ref("new", 20), hunk: 1, lines: at(OLDER, ref("new", 20)) }]);
});

test("a file thread, an outdated one, and one only on another commit's lines go at the file, each said why", () => {
  const file = thread({ kind: "file" });
  const written = at(OLDER, ref("new", 12), ref("new", 9));
  const outdated = thread(onLines(written), { outdated: true });
  const newer = thread(onLines(at(HEAD, ref("new", 21)), written));

  assert.deepEqual(placeThreads([file, outdated, newer], PATH, "c".repeat(40), ROWS), {
    lines: [],
    file: [
      { thread: file, why: "file" },
      { thread: outdated, why: "outdated", last: written },
      { thread: newer, why: "elsewhere", last: at(HEAD, ref("new", 21)) },
    ],
  });
});

test("a thread whose last line this diff doesn't draw goes at the file, not nowhere", () => {
  const offDiff = thread(onLines(at(HEAD, ref("new", 30))));

  assert.deepEqual(placeThreads([offDiff], PATH, HEAD, ROWS), { lines: [], file: [{ thread: offDiff, why: "elsewhere", last: at(HEAD, ref("new", 30)) }] });
});

test("other files' threads are left out", () => {
  assert.deepEqual(placeThreads([thread({ kind: "file" }, { path: "src/other.ts" })], PATH, HEAD, ROWS), { lines: [], file: [] });
});

test("a guide hunk draws the threads on its own lines, and its file's only as the file's first block", () => {
  const first = thread(onLines(at(HEAD, ref("old", 5))));
  const second = thread(onLines(at(HEAD, ref("new", 21))));
  const file = thread({ kind: "file" });
  const placed = placeThreads([first, second, file], PATH, HEAD, ROWS);

  assert.deepEqual(threadsOfHunk(placed, 1, true), { lines: [{ thread: second, at: ref("new", 21), hunk: 1, lines: at(HEAD, ref("new", 21)) }], file: [{ thread: file, why: "file" }] });
  assert.deepEqual(threadsOfHunk(placed, 0, false), { lines: [{ thread: first, at: ref("old", 5), hunk: 0, lines: at(HEAD, ref("old", 5)) }], file: [] });
});

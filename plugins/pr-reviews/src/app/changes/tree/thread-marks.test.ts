import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewThread } from "../../../comments/thread-schema.ts";
import { diffFile } from "../diff-file.fixture.ts";
import { filesByTreePathOf } from "./tree-input.ts";
import { threadMarksOf } from "./thread-marks.ts";

let nextId = 0;

function thread(path: string, { resolved = false, outdated = false, subject = "lines" as "lines" | "file" } = {}): ReviewThread {
  const id = ++nextId;
  return {
    id: `PRRT_${id}`,
    path,
    resolvedBy: resolved ? "octocat" : null,
    outdated,
    subject: subject === "file" ? { kind: "file" } : { kind: "lines", anchors: [], excerpt: [] },
    comments: [{ id, url: `https://github.com/o/r/pull/1#discussion_r${id}`, author: { login: "octocat", bot: false }, body: "Why?", createdAt: "2026-11-10T08:00:00Z" }],
  };
}

const OPEN = "var(--pr-reviews-thread-mark-open)";
const RESOLVED = "var(--pr-reviews-thread-mark-resolved)";

test("marks each file with review threads, wherever they sit, and leaves the others unmarked", () => {
  const files = filesByTreePathOf([diffFile("src/a.ts"), diffFile("src/b.ts"), diffFile("src/c.ts")]);
  const marks = threadMarksOf([thread("src/a.ts"), thread("src/a.ts", { subject: "file" }), thread("src/a.ts", { outdated: true }), thread("src/c.ts")], files);

  assert.deepEqual([...marks], [
    ["src/a.ts", { part: { text: "•", color: OPEN }, title: "3 comment threads" }],
    ["src/c.ts", { part: { text: "•", color: OPEN }, title: "1 comment thread" }],
  ]);
});

test("a file whose threads are all resolved keeps a receding mark; one with some open stays bright", () => {
  const files = filesByTreePathOf([diffFile("settled.ts"), diffFile("mixed.ts")]);
  const marks = threadMarksOf([thread("settled.ts", { resolved: true }), thread("mixed.ts", { resolved: true }), thread("mixed.ts"), thread("mixed.ts")], files);

  assert.deepEqual(marks.get("settled.ts"), { part: { text: "•", color: RESOLVED }, title: "1 resolved comment thread" });
  assert.deepEqual(marks.get("mixed.ts"), { part: { text: "•", color: OPEN }, title: "3 comment threads, 1 resolved" });
});

test("a renamed file is marked by the threads on its new path, as its diff draws them", () => {
  const files = filesByTreePathOf([diffFile("src/new-name.ts", { status: "renamed", previousPath: "src/old-name.ts" })]);
  const marks = threadMarksOf([thread("src/new-name.ts"), thread("src/new-name.ts", { resolved: true })], files);

  assert.deepEqual([...marks.keys()], ["src/new-name.ts"]);
  assert.equal(marks.get("src/new-name.ts")?.title, "2 comment threads, 1 resolved");
});

test("a file on a disambiguated tree path carries its own threads, and the folder's file keeps its own", () => {
  const files = filesByTreePathOf([diffFile("lib/a", { status: "deleted" }), diffFile("lib/a/b.ts", { status: "added" })]);
  const fileTreePath = [...files].find(([, file]) => file.path === "lib/a")![0];
  const marks = threadMarksOf([thread("lib/a"), thread("lib/a"), thread("lib/a/b.ts")], files);

  assert.notEqual(fileTreePath, "lib/a");
  assert.deepEqual(
    [...marks].map(([treePath, mark]) => [treePath, mark.title]),
    [
      [fileTreePath, "2 comment threads"],
      ["lib/a/b.ts", "1 comment thread"],
    ],
  );
});

test("threads on a file the tree doesn't show mark nothing", () => {
  const marks = threadMarksOf([thread("filtered-out.ts")], filesByTreePathOf([diffFile("shown.ts")]));

  assert.equal(marks.size, 0);
});

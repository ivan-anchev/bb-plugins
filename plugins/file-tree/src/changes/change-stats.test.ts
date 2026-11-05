import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedFile } from "../changed-file.fixture.ts";
import { changeSummaryOf, fileStatPartsOf, lineStatPartsOf, plainTextOf } from "./change-stats.ts";

const statTextOf = (...args: Parameters<typeof changedFile>) => plainTextOf(fileStatPartsOf(changedFile(...args)));

describe("fileStatPartsOf", () => {
  test("shows both counts for a modified file, zeros included", () => {
    assert.equal(statTextOf("README.md", { additions: 3, deletions: 0 }), "+3 -0");
    assert.equal(statTextOf("LICENSE", { additions: 0, deletions: 2 }), "+0 -2");
  });

  test("shows only insertions for an added file and only deletions for a deleted one", () => {
    assert.equal(statTextOf("notes.md", { changeKind: "added", additions: 4, deletions: 0 }), "+4");
    assert.equal(statTextOf("old.md", { changeKind: "deleted", additions: 0, deletions: 9 }), "-9");
  });

  test("shows nothing for an empty added file", () => {
    assert.deepEqual(fileStatPartsOf(changedFile("empty.txt", { changeKind: "added", additions: 0, deletions: 0 })), []);
  });

  test("labels binary files instead of counting lines", () => {
    assert.deepEqual(fileStatPartsOf(changedFile("pixel.png", { binary: true, additions: 0, deletions: 0 })), [
      { text: "Binary", tone: "muted" },
    ]);
  });

  test("groups thousands like bb", () => {
    assert.deepEqual(lineStatPartsOf({ insertions: 1261, deletions: 3 }), [
      { text: "+1,261", tone: "added" },
      { text: "-3", tone: "removed" },
    ]);
  });
});

describe("changeSummaryOf", () => {
  const files = [
    changedFile("README.md", { additions: 3, deletions: 0 }),
    changedFile("LICENSE", { additions: 0, deletions: 2 }),
    changedFile("notes.md", { changeKind: "added", additions: 4, deletions: 0 }),
  ];

  test("counts files and lines", () => {
    assert.deepEqual(changeSummaryOf({ shown: files, totalCount: 3, truncated: false, filtering: false }), {
      text: "3 files, ",
      stats: { insertions: 7, deletions: 2 },
      title: "3 files, +7 -2",
    });
  });

  test("says No changes when nothing changed", () => {
    assert.equal(changeSummaryOf({ shown: [], totalCount: 0, truncated: false, filtering: false }).text, "No changes");
  });

  test("leaves the line counts out when no lines changed", () => {
    const renamed = [changedFile("b.ts", { changeKind: "renamed", additions: 0, deletions: 0 })];
    assert.deepEqual(changeSummaryOf({ shown: renamed, totalCount: 1, truncated: false, filtering: false }), {
      text: "1 file",
      stats: null,
      title: "1 file",
    });
  });

  test("reports how many files match a filter", () => {
    const summary = changeSummaryOf({ shown: files.slice(0, 1), totalCount: 3, truncated: false, filtering: true });
    assert.equal(summary.text, "1 of 3 files · ");
    assert.equal(summary.title, "1 of 3 changed files match the filter");
  });

  test("marks a truncated list", () => {
    assert.equal(changeSummaryOf({ shown: files, totalCount: 3, truncated: true, filtering: false }).text, "3+ files · shown ");
  });
});

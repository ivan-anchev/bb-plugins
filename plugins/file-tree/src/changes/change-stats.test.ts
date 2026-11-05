import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedFile } from "../changed-file.fixture.ts";
import { changeSummaryOf, fileStatPartsOf, lineStatPartsOf, plainTextOf, type LineStats } from "./change-stats.ts";
import { NO_FILTERS, filterChangedFiles, isFiltering, withExtensionShown, withKindsShown } from "./file-filter.ts";

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
    const { breakdown, ...headline } = changeSummaryOf({ shown: files, totalCount: 3, truncated: false, filtering: false });
    assert.deepEqual(headline, { text: "3 files, ", stats: { insertions: 7, deletions: 2 }, title: "3 files, +7 -2" });
    assert.deepEqual(breakdown.rows, [
      { kind: "code", stats: { insertions: 0, deletions: 2 } },
      { kind: "docs", stats: { insertions: 7, deletions: 0 } },
    ]);
  });

  test("says No changes when nothing changed", () => {
    assert.equal(changeSummaryOf({ shown: [], totalCount: 0, truncated: false, filtering: false }).text, "No changes");
  });

  test("leaves the line counts out when no lines changed", () => {
    const renamed = [changedFile("b.ts", { changeKind: "renamed", additions: 0, deletions: 0 })];
    const { breakdown, ...headline } = changeSummaryOf({ shown: renamed, totalCount: 1, truncated: false, filtering: false });
    assert.deepEqual(headline, { text: "1 file", stats: null, title: "1 file" });
    assert.deepEqual(breakdown.rows, []);
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

describe("the kind breakdown", () => {
  const files = [
    changedFile("src/tree.ts", { additions: 12, deletions: 4 }),
    changedFile("src/view.tsx", { additions: 3, deletions: 1 }),
    changedFile("src/tree.test.ts", { additions: 20, deletions: 0 }),
    changedFile("src/tree.fixture.ts", { additions: 6, deletions: 2 }),
    changedFile("package-lock.json", { additions: 300, deletions: 120 }),
    changedFile("README.md", { additions: 2, deletions: 2 }),
    changedFile("docs/old.md", { changeKind: "renamed", previousPath: "docs/new.md", additions: 0, deletions: 0 }),
  ];
  const summaryOf = (query: string | null, filters = NO_FILTERS) =>
    changeSummaryOf({
      shown: filterChangedFiles(files, query, filters),
      totalCount: files.length,
      truncated: false,
      filtering: isFiltering(query, filters),
    });
  const sumOf = (rows: readonly { stats: LineStats }[]): LineStats => ({
    insertions: rows.reduce((sum, row) => sum + row.stats.insertions, 0),
    deletions: rows.reduce((sum, row) => sum + row.stats.deletions, 0),
  });

  test("splits the lines by kind in display order", () => {
    assert.deepEqual(summaryOf(null).breakdown, {
      rows: [
        { kind: "code", stats: { insertions: 15, deletions: 5 } },
        { kind: "tests", stats: { insertions: 20, deletions: 0 } },
        { kind: "mocks", stats: { insertions: 6, deletions: 2 } },
        { kind: "generated", stats: { insertions: 300, deletions: 120 } },
        { kind: "docs", stats: { insertions: 2, deletions: 2 } },
      ],
      totalLabel: "Total",
    });
  });

  test("leaves out kinds with no lines", () => {
    const shown = [changedFile("src/a.ts"), changedFile("docs/b.md", { changeKind: "renamed", additions: 0, deletions: 0 })];
    const { rows } = changeSummaryOf({ shown, totalCount: 2, truncated: false, filtering: false }).breakdown;
    assert.deepEqual(rows, [{ kind: "code", stats: { insertions: 1, deletions: 1 } }]);
  });

  test("adds up to the headline total for any filter", () => {
    const states: [string | null, typeof NO_FILTERS][] = [
      [null, NO_FILTERS],
      ["src", NO_FILTERS],
      ["*.ts, !*.test.ts", NO_FILTERS],
      [null, withExtensionShown(NO_FILTERS, ".md", true)],
      [null, withKindsShown(NO_FILTERS, ["tests", "mocks"], false)],
      [null, withKindsShown(NO_FILTERS, ["code", "generated"], false)],
      ["tree", withKindsShown(NO_FILTERS, ["code"], false)],
      ["old.md", NO_FILTERS],
    ];
    for (const [query, filters] of states) {
      const summary = summaryOf(query, filters);
      assert.deepEqual(sumOf(summary.breakdown.rows), summary.stats ?? { insertions: 0, deletions: 0 });
    }
  });

  test("labels the total of a truncated list as the shown slice", () => {
    const summary = changeSummaryOf({ shown: files, totalCount: files.length, truncated: true, filtering: false });
    assert.equal(summary.breakdown.totalLabel, "Shown slice");
    assert.deepEqual(sumOf(summary.breakdown.rows), summary.stats);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedFile } from "../changed-file.fixture.ts";
import type { ChangedFile } from "../git.ts";
import { changeSummaryOf, fileStatPartsOf, lineStatPartsOf, plainTextOf, type LineStats } from "./change-stats.ts";
import {
  NO_FILTERS,
  filterChangedFiles,
  isFiltering,
  withExtensionShown,
  withKindsShown,
  type FileFilters,
} from "./file-filter.ts";

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
  const unfiltered = (all: readonly ChangedFile[], truncated = false) =>
    changeSummaryOf({ files: all, shown: all, truncated, filtering: false });

  test("counts files and lines", () => {
    const { breakdown, ...headline } = unfiltered(files);
    assert.deepEqual(headline, { text: "3 files, ", stats: { insertions: 7, deletions: 2 }, title: "3 files, +7 -2" });
    assert.deepEqual(breakdown.rows, [
      { kind: "code", stats: { insertions: 0, deletions: 2 } },
      { kind: "docs", stats: { insertions: 7, deletions: 0 } },
    ]);
  });

  test("says No changes when nothing changed", () => {
    assert.equal(unfiltered([]).text, "No changes");
  });

  test("leaves the line counts out when no lines changed", () => {
    const { breakdown, ...headline } = unfiltered([changedFile("b.ts", { changeKind: "renamed", additions: 0, deletions: 0 })]);
    assert.deepEqual(headline, { text: "1 file", stats: null, title: "1 file" });
    assert.deepEqual(breakdown.rows, []);
  });

  test("reports how many files match a filter beside the lines of all changes", () => {
    const { breakdown, ...headline } = changeSummaryOf({ files, shown: files.slice(0, 1), truncated: false, filtering: true });
    assert.deepEqual(headline, {
      text: "1 of 3 files · ",
      stats: { insertions: 7, deletions: 2 },
      title: "1 of 3 changed files match the filter",
    });
  });

  test("marks a truncated list", () => {
    const summary = unfiltered(files, true);
    assert.equal(summary.text, "3+ files · shown ");
    assert.equal(summary.title, "Showing the first 3 files; shown slice: 7 insertions, 2 deletions");
  });

  test("marks a truncated list while a filter is on", () => {
    const summary = changeSummaryOf({ files, shown: files.slice(0, 1), truncated: true, filtering: true });
    assert.equal(summary.text, "1 of 3+ files · shown ");
    assert.equal(summary.title, "1 of 3+ changed files match the filter");
    assert.deepEqual(summary.stats, { insertions: 7, deletions: 2 });
    assert.equal(summary.breakdown.totalLabel, "Shown slice");
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
    changedFile("docs/gone.md", { changeKind: "deleted", additions: 0, deletions: 7 }),
    changedFile("docs/old.md", { changeKind: "renamed", previousPath: "docs/new.md", additions: 0, deletions: 0 }),
  ];
  const summaryOf = (query: string | null, filters = NO_FILTERS, truncated = false) =>
    changeSummaryOf({
      files,
      shown: filterChangedFiles(files, query, filters),
      truncated,
      filtering: isFiltering(query, filters),
    });
  const sumOf = (rows: readonly { stats: LineStats }[]): LineStats => ({
    insertions: rows.reduce((sum, row) => sum + row.stats.insertions, 0),
    deletions: rows.reduce((sum, row) => sum + row.stats.deletions, 0),
  });
  const filterStates: [string | null, FileFilters][] = [
    [null, NO_FILTERS],
    ["src", NO_FILTERS],
    ["*.ts, !*.test.ts", NO_FILTERS],
    ["nothing-matches", NO_FILTERS],
    [null, withExtensionShown(NO_FILTERS, ".md", true)],
    [null, { ...NO_FILTERS, showDeleted: false }],
    [null, withKindsShown(NO_FILTERS, ["tests", "mocks"], false)],
    [null, withKindsShown(NO_FILTERS, ["code", "generated"], false)],
    ["tree", withKindsShown(NO_FILTERS, ["code"], false)],
    ["old.md", NO_FILTERS],
  ];

  test("splits the lines by kind in display order", () => {
    assert.deepEqual(summaryOf(null).breakdown, {
      rows: [
        { kind: "code", stats: { insertions: 15, deletions: 5 } },
        { kind: "tests", stats: { insertions: 20, deletions: 0 } },
        { kind: "mocks", stats: { insertions: 6, deletions: 2 } },
        { kind: "generated", stats: { insertions: 300, deletions: 120 } },
        { kind: "docs", stats: { insertions: 2, deletions: 9 } },
      ],
      totalLabel: "Total",
    });
  });

  test("leaves out kinds with no lines", () => {
    const shown = [changedFile("src/a.ts"), changedFile("docs/b.md", { changeKind: "renamed", additions: 0, deletions: 0 })];
    const { rows } = changeSummaryOf({ files: shown, shown, truncated: false, filtering: false }).breakdown;
    assert.deepEqual(rows, [{ kind: "code", stats: { insertions: 1, deletions: 1 } }]);
  });

  test("keeps the stats and the breakdown of all changes under any filter, and the rows add up to the stats", () => {
    const unfiltered = summaryOf(null);
    for (const [query, filters] of filterStates) {
      const summary = summaryOf(query, filters);
      assert.deepEqual(summary.stats, unfiltered.stats);
      assert.deepEqual(summary.breakdown, unfiltered.breakdown);
      assert.deepEqual(sumOf(summary.breakdown.rows), summary.stats);
    }
  });

  test("labels the total of a truncated list as the shown slice under any filter", () => {
    for (const [query, filters] of filterStates) {
      const summary = summaryOf(query, filters, true);
      assert.equal(summary.breakdown.totalLabel, "Shown slice");
      assert.match(summary.text, / · shown $/);
      assert.deepEqual(sumOf(summary.breakdown.rows), summary.stats);
    }
  });
});

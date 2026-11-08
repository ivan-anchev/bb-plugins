import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DiffFile, LineCounts } from "../../diff/diff-schema.ts";
import { changeSummaryOf, fileStatPartsOf, lineStatPartsOf, plainTextOf } from "./change-stats.ts";
import { diffFile } from "./diff-file.fixture.ts";
import { NO_FILTERS, filterChangedFiles, isFiltering, withExtensionShown, withKindsShown, type FileFilters } from "./file-filter.ts";

const statTextOf = (...args: Parameters<typeof diffFile>) => plainTextOf(fileStatPartsOf(diffFile(...args)));

describe("fileStatPartsOf", () => {
  test("shows both counts for a modified file, zeros included", () => {
    assert.equal(statTextOf("README.md", { added: 3, removed: 0 }), "+3 −0");
    assert.equal(statTextOf("LICENSE", { added: 0, removed: 2 }), "+0 −2");
  });

  test("shows only additions for an added file and only removals for a deleted one", () => {
    assert.equal(statTextOf("notes.md", { status: "added", added: 4, removed: 0 }), "+4");
    assert.equal(statTextOf("old.md", { status: "deleted", added: 0, removed: 9 }), "−9");
  });

  test("shows nothing for an empty added file", () => {
    assert.deepEqual(fileStatPartsOf(diffFile("empty.txt", { status: "added", added: 0, removed: 0 })), []);
  });

  test("labels binary files instead of counting lines", () => {
    assert.deepEqual(fileStatPartsOf(diffFile("pixel.png", { binary: true, added: 0, removed: 0 })), [{ text: "Binary", tone: "muted" }]);
  });

  test("groups thousands like bb", () => {
    assert.deepEqual(lineStatPartsOf({ added: 1261, removed: 3 }), [
      { text: "+1,261", tone: "added" },
      { text: "−3", tone: "removed" },
    ]);
  });
});

describe("changeSummaryOf", () => {
  const files = [
    diffFile("README.md", { added: 3, removed: 0 }),
    diffFile("LICENSE", { added: 0, removed: 2 }),
    diffFile("notes.md", { status: "added", added: 4, removed: 0 }),
  ];
  const unfiltered = (all: readonly DiffFile[]) => changeSummaryOf({ files: all, shown: all, filtering: false });

  test("counts files and lines", () => {
    const { breakdown, ...headline } = unfiltered(files);
    assert.deepEqual(headline, { text: "3 files, ", counts: { added: 7, removed: 2 }, title: "3 files, +7 −2" });
    assert.deepEqual(breakdown, [
      { kind: "code", counts: { added: 0, removed: 2 } },
      { kind: "docs", counts: { added: 7, removed: 0 } },
    ]);
  });

  test("says No changes when nothing changed", () => {
    assert.equal(unfiltered([]).text, "No changes");
  });

  test("leaves the line counts out when no lines changed", () => {
    const { breakdown, ...headline } = unfiltered([diffFile("b.ts", { status: "renamed", added: 0, removed: 0 })]);
    assert.deepEqual(headline, { text: "1 file", counts: null, title: "1 file" });
    assert.deepEqual(breakdown, []);
  });

  test("reports how many files match a filter beside the lines of all changes", () => {
    const { breakdown, ...headline } = changeSummaryOf({ files, shown: files.slice(0, 1), filtering: true });
    assert.deepEqual(headline, { text: "1 of 3 files · ", counts: { added: 7, removed: 2 }, title: "1 of 3 changed files match the filter" });
  });
});

describe("the kind breakdown", () => {
  const files = [
    diffFile("src/tree.ts", { added: 12, removed: 4 }),
    diffFile("src/view.tsx", { added: 3, removed: 1 }),
    diffFile("src/tree.test.ts", { added: 20, removed: 0 }),
    diffFile("src/tree.fixture.ts", { added: 6, removed: 2 }),
    diffFile("package-lock.json", { added: 300, removed: 120 }),
    diffFile("README.md", { added: 2, removed: 2 }),
    diffFile("docs/gone.md", { status: "deleted", added: 0, removed: 7 }),
    diffFile("docs/old.md", { status: "renamed", previousPath: "docs/new.md", added: 0, removed: 0 }),
  ];
  const summaryOf = (query: string | null, filters = NO_FILTERS) =>
    changeSummaryOf({ files, shown: filterChangedFiles(files, query, filters), filtering: isFiltering(query, filters) });
  const sumOf = (rows: readonly { counts: LineCounts }[]): LineCounts => ({
    added: rows.reduce((sum, row) => sum + row.counts.added, 0),
    removed: rows.reduce((sum, row) => sum + row.counts.removed, 0),
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
    assert.deepEqual(summaryOf(null).breakdown, [
      { kind: "code", counts: { added: 15, removed: 5 } },
      { kind: "tests", counts: { added: 20, removed: 0 } },
      { kind: "mocks", counts: { added: 6, removed: 2 } },
      { kind: "generated", counts: { added: 300, removed: 120 } },
      { kind: "docs", counts: { added: 2, removed: 9 } },
    ]);
  });

  test("leaves out kinds with no lines", () => {
    const shown = [diffFile("src/a.ts"), diffFile("docs/b.md", { status: "renamed", added: 0, removed: 0 })];
    assert.deepEqual(changeSummaryOf({ files: shown, shown, filtering: false }).breakdown, [{ kind: "code", counts: { added: 1, removed: 1 } }]);
  });

  test("keeps the counts and the breakdown of all changes under any filter, and the rows add up to the counts", () => {
    const all = summaryOf(null);
    for (const [query, filters] of filterStates) {
      const summary = summaryOf(query, filters);
      assert.deepEqual(summary.counts, all.counts);
      assert.deepEqual(summary.breakdown, all.breakdown);
      assert.deepEqual(sumOf(summary.breakdown), summary.counts);
    }
  });
});

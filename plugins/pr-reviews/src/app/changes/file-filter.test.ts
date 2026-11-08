import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diffFile } from "./diff-file.fixture.ts";
import {
  NO_FILTERS,
  extensionCountsOf,
  filterChangedFiles,
  hidesKinds,
  isFiltering,
  kindCountsOf,
  withExtensionShown,
  withKindsShown,
} from "./file-filter.ts";

const FILES = [
  diffFile("README.md"),
  diffFile("docs/guide.md"),
  diffFile("docs/api/index.ts"),
  diffFile("src/tree.test.ts"),
  diffFile("src/tree.ts"),
  diffFile("src/new-name.ts", { status: "renamed", previousPath: "src/old-name.ts" }),
  diffFile("LICENSE", { status: "deleted" }),
];

const pathsMatching = (query: string | null, filters = NO_FILTERS) =>
  filterChangedFiles(FILES, query, filters).map((file) => file.path);

describe("filterChangedFiles by path", () => {
  test("keeps every file for an empty query", () => {
    assert.equal(pathsMatching(null).length, FILES.length);
    assert.equal(pathsMatching("  ").length, FILES.length);
  });

  test("matches plain text anywhere in the path, ignoring case", () => {
    assert.deepEqual(pathsMatching("TREE"), ["src/tree.test.ts", "src/tree.ts"]);
  });

  test("matches a glob without a slash against file names", () => {
    assert.deepEqual(pathsMatching("*.md"), ["README.md", "docs/guide.md"]);
  });

  test("matches a glob with a slash against whole paths", () => {
    assert.deepEqual(pathsMatching("docs\u002f**"), ["docs/guide.md", "docs/api/index.ts"]);
  });

  test("combines comma-separated terms and drops negated ones", () => {
    assert.deepEqual(pathsMatching("*.ts, !*.test.ts"), ["docs/api/index.ts", "src/tree.ts", "src/new-name.ts"]);
  });

  test("finds a renamed file by its previous path", () => {
    assert.deepEqual(pathsMatching("old-name"), ["src/new-name.ts"]);
  });

  test("falls back to a prefix match while a glob is still being typed", () => {
    assert.deepEqual(pathsMatching("*.te"), ["src/tree.test.ts"]);
  });
});

describe("filterChangedFiles by type", () => {
  test("keeps only the chosen extensions", () => {
    assert.deepEqual(pathsMatching(null, withExtensionShown(NO_FILTERS, ".md", true)), ["README.md", "docs/guide.md"]);
  });

  test("hides deleted files when asked", () => {
    assert.ok(!pathsMatching(null, { ...NO_FILTERS, showDeleted: false }).includes("LICENSE"));
  });
});

describe("filterChangedFiles by kind", () => {
  test("hides the files of a hidden kind", () => {
    assert.deepEqual(pathsMatching(null, withKindsShown(NO_FILTERS, ["docs"], false)), [
      "docs/api/index.ts",
      "src/tree.test.ts",
      "src/tree.ts",
      "src/new-name.ts",
      "LICENSE",
    ]);
  });

  test("combines with the path query", () => {
    assert.deepEqual(pathsMatching("tree", withKindsShown(NO_FILTERS, ["tests"], false)), ["src/tree.ts"]);
  });

  test("kinds a renamed file by its new path", () => {
    const renamed = [diffFile("src/a.ts", { status: "renamed", previousPath: "src/a.test.ts" })];
    assert.deepEqual(filterChangedFiles(renamed, null, withKindsShown(NO_FILTERS, ["tests"], false)), renamed);
  });
});

describe("withKindsShown and hidesKinds", () => {
  test("hides and shows several kinds at once", () => {
    const hidden = withKindsShown(NO_FILTERS, ["tests", "mocks"], false);
    assert.deepEqual(hidden.hiddenKinds, ["tests", "mocks"]);
    assert.equal(hidesKinds(hidden, ["tests", "mocks"]), true);
    assert.deepEqual(withKindsShown(hidden, ["tests", "mocks"], true).hiddenKinds, []);
  });

  test("hides each kind once", () => {
    const tests = withKindsShown(NO_FILTERS, ["tests"], false);
    assert.deepEqual(withKindsShown(tests, ["tests", "mocks"], false).hiddenKinds, ["tests", "mocks"]);
  });

  test("hides a group only while every kind in it is hidden", () => {
    const testsOnly = withKindsShown(NO_FILTERS, ["tests"], false);
    assert.equal(hidesKinds(testsOnly, ["tests", "mocks"]), false);
    assert.equal(hidesKinds(withKindsShown(testsOnly, ["mocks"], false), ["tests", "mocks"]), true);
    assert.equal(hidesKinds(withKindsShown(testsOnly, ["mocks"], false), ["tests"]), true);
  });
});

describe("withExtensionShown", () => {
  test("adds and removes one extension", () => {
    const shown = withExtensionShown(NO_FILTERS, ".ts", true);
    assert.deepEqual(shown.extensions, [".ts"]);
    assert.deepEqual(withExtensionShown(shown, ".ts", false).extensions, []);
  });
});

describe("isFiltering", () => {
  test("is off for no query and default filters", () => {
    assert.equal(isFiltering(null, NO_FILTERS), false);
    assert.equal(isFiltering(" ", NO_FILTERS), false);
  });

  test("is on for a query, an extension, hidden deleted files, or a hidden kind", () => {
    assert.equal(isFiltering("*.md", NO_FILTERS), true);
    assert.equal(isFiltering(null, withExtensionShown(NO_FILTERS, ".md", true)), true);
    assert.equal(isFiltering(null, { ...NO_FILTERS, showDeleted: false }), true);
    assert.equal(isFiltering(null, withKindsShown(NO_FILTERS, ["generated"], false)), true);
  });
});

describe("extensionCountsOf", () => {
  test("counts files per extension, sorted, with files without one under an empty key", () => {
    assert.deepEqual(extensionCountsOf(FILES), [
      ["", 1],
      [".md", 2],
      [".ts", 4],
    ]);
  });
});

describe("kindCountsOf", () => {
  test("counts files per present kind in display order", () => {
    assert.deepEqual(kindCountsOf(FILES), [
      ["code", 4],
      ["tests", 1],
      ["docs", 2],
    ]);
  });
});

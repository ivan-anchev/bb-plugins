import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedFile } from "../changed-file.fixture.ts";
import {
  NO_FILTERS,
  extensionCountsOf,
  filterChangedFiles,
  isFiltering,
  withExtensionShown,
} from "./file-filter.ts";

const FILES = [
  changedFile("README.md"),
  changedFile("docs/guide.md"),
  changedFile("docs/api/index.ts"),
  changedFile("src/tree.test.ts"),
  changedFile("src/tree.ts"),
  changedFile("src/new-name.ts", { changeKind: "renamed", previousPath: "src/old-name.ts" }),
  changedFile("LICENSE", { changeKind: "deleted" }),
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

  test("is on for a query, an extension, or hidden deleted files", () => {
    assert.equal(isFiltering("*.md", NO_FILTERS), true);
    assert.equal(isFiltering(null, withExtensionShown(NO_FILTERS, ".md", true)), true);
    assert.equal(isFiltering(null, { ...NO_FILTERS, showDeleted: false }), true);
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

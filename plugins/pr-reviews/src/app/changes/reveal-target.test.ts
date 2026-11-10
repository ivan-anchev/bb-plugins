import assert from "node:assert/strict";
import { test } from "node:test";
import { diffFile } from "./diff-file.fixture.ts";
import { filterChangedFiles, NO_FILTERS } from "./file-filter.ts";
import { revealTargetOf } from "./reveal-target.ts";
import { filesByTreePathOf } from "./tree/tree-input.ts";

const FILES = [diffFile("README.md"), diffFile("src/a.ts"), diffFile("src/a.ts/b.ts")];

// The target as the panel resolves it, under a path query.
const targetUnder = (pathQuery: string | null, path: string) => revealTargetOf(path, filesByTreePathOf(filterChangedFiles(FILES, pathQuery, NO_FILTERS)), FILES);

test("a file the tree shows: its row", () => {
  assert.deepEqual(targetUnder(null, "README.md"), { kind: "shown", treePath: "README.md" });
  assert.deepEqual(targetUnder("src", "src/a.ts/b.ts"), { kind: "shown", treePath: "src/a.ts/b.ts" });
});

test("a file the filter hides: its row in the whole diff's tree, where a folder's path pushes it aside", () => {
  assert.deepEqual(targetUnder("!README.md", "README.md"), { kind: "filtered-out", treePath: "README.md" });
  assert.deepEqual(targetUnder("README", "src/a.ts"), { kind: "filtered-out", treePath: "src/a.ts​" });
});

test("a file not in the diff: absent, filtered or not", () => {
  assert.deepEqual(targetUnder(null, "gone.ts"), { kind: "absent" });
  assert.deepEqual(targetUnder("README", "gone.ts"), { kind: "absent" });
});

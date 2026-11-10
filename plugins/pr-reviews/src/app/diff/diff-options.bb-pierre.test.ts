import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import * as pierre from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { parsePrDiff } from "../../diff/parse-pr-diff.ts";

// The Pierre bb 0.49 runs for plugins reads a `---` or `+++` header's name raw: matched with
// FILENAME_HEADER_REGEX and trimmed, never unquoted. The Pierre these tests import decodes a quoted
// name, so on its own it reads back names bb never sees. A name bb reads with its quotes is plain
// text to Pierre, and the file's code goes uncoloured.
function asBbReads(diff: FileDiffMetadata, patch: string): FileDiffMetadata {
  let name = diff.name;
  let prevName: string | undefined;
  for (const line of patch.split("\n", 2)) {
    const [, side, raw] = line.match(pierre.FILENAME_HEADER_REGEX) ?? [];
    if (raw === undefined || raw === "/dev/null") continue;
    name = raw.trim();
    if (side === "---") prevName = name;
  }
  if (prevName === undefined || prevName === name) return { ...diff, name, prevName: undefined };
  return { ...diff, name, prevName, type: diff.hunks.length > 0 ? "rename-changed" : "rename-pure" };
}

mock.module("@pierre/diffs", {
  namedExports: {
    ...pierre,
    getSingularPatch: (patch: string) => asBbReads(pierre.getSingularPatch(patch), patch),
    processFile: (...[patch, options]: Parameters<typeof pierre.processFile>) => {
      const diff = pierre.processFile(patch, options);
      return diff && asBbReads(diff, patch);
    },
  },
});
const { fileDiffOf } = await import("./diff-options.ts");

const fixture = (name: string) => parsePrDiff(readFileSync(new URL(`../../diff/fixtures/${name}`, import.meta.url), "utf8"));

// The new side of a fixture whose one hunk starts the file and runs to its end.
const newSideOf = (file: DiffFile) =>
  file.status === "deleted" ? "" : file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line[0] !== "-").map((line) => line.slice(1))).join("\n") + "\n";

test("in bb's Pierre, a TypeScript file's diff is TypeScript, before and after its text is read", () => {
  const [file] = fixture("hidden-path.diff");
  assert.equal(file.path, "src/a.ts");

  for (const diff of [fileDiffOf(file, null), fileDiffOf(file, newSideOf(file))]) {
    assert.deepEqual([diff.name, diff.prevName, pierre.getFiletypeFromFileName(diff.name)], ["src/a.ts", undefined, "typescript"]);
  }
});

test("in bb's Pierre, each file is named by its exact path, whatever bytes it holds, so its language is the path's", () => {
  const fixtures = ["added.diff", "deleted.diff", "space-paths.diff", "escaped-path.diff", "quoted-path.diff", "hidden-path.diff", "line-separator-paths.diff"];
  const files = fixtures.flatMap(fixture).filter((file) => file.hunks.length > 0);
  assert.ok(files.some((file) => file.path.includes("\t")), "the fixtures hold a path with a tab");

  for (const file of files) {
    for (const diff of [fileDiffOf(file, null), fileDiffOf(file, newSideOf(file))]) {
      const language = pierre.getFiletypeFromFileName(diff.name);
      assert.deepEqual([diff.name, diff.prevName, language], [file.path, undefined, pierre.getFiletypeFromFileName(file.path)], JSON.stringify(file.path));
    }
  }
});

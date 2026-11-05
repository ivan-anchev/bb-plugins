import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChangedFile } from "./git.ts";
import { FileTree, createFileTreeIconResolver } from "@pierre/trees";
import { changedFile } from "./changed-file.fixture.ts";
import { TREE_ICONS, changesTreeOf, treePathsOf } from "./tree-input.ts";

describe("treePathsOf", () => {
  test("marks directories with a trailing slash and keeps files as they are", () => {
    const paths = treePathsOf([
      { kind: "directory", path: "src" },
      { kind: "directory", path: "src/components" },
      { kind: "file", path: "src/components/tree.tsx" },
      { kind: "file", path: "src/index.ts" },
      { kind: "directory", path: ".github" },
      { kind: "file", path: "README.md" },
    ]);

    assert.deepEqual(paths, [
      "src/",
      "src/components/",
      "src/components/tree.tsx",
      "src/index.ts",
      ".github/",
      "README.md",
    ]);
  });

  test("returns no paths for an empty environment", () => {
    assert.deepEqual(treePathsOf([]), []);
  });
});

describe("changesTreeOf", () => {
  const change = (path: string, changeKind: ChangedFile["changeKind"]): ChangedFile =>
    changedFile(path, { changeKind });

  test("maps every tracked change kind to the tree's git status", () => {
    const tree = changesTreeOf([
      change("a/added.ts", "added"),
      change("a/modified.ts", "modified"),
      change("a/deleted.ts", "deleted"),
      change("a/renamed.ts", "renamed"),
      change("a/copied.ts", "copied"),
      change("a/type-changed.ts", "type_changed"),
    ]);

    assert.deepEqual(tree.gitStatus, [
      { path: "a/added.ts", status: "added" },
      { path: "a/modified.ts", status: "modified" },
      { path: "a/deleted.ts", status: "deleted" },
      { path: "a/renamed.ts", status: "renamed" },
      { path: "a/copied.ts", status: "added" },
      { path: "a/type-changed.ts", status: "modified" },
    ]);
  });

  test("reports untracked files as untracked whatever their change kind", () => {
    const tree = changesTreeOf([changedFile("notes.md", { changeKind: "added", origin: "untracked" })]);

    assert.deepEqual(tree.gitStatus, [{ path: "notes.md", status: "untracked" }]);
  });

  test("uses the real paths as tree paths when no file stands where a directory is", () => {
    const files = [change("src/index.ts", "modified"), change("README.md", "added")];
    const tree = changesTreeOf(files);

    assert.deepEqual(tree.paths, ["src/index.ts", "README.md"]);
    assert.deepEqual([...tree.filesByTreePath.values()], files);
  });

  for (const [scenario, files] of [
    ["a deleted file replaced by a directory", [change("lib/a", "deleted"), change("lib/a/b.ts", "added")]],
    ["a deleted directory replaced by a file", [change("lib/a/b.ts", "deleted"), change("lib/a", "added")]],
  ] as const) {
    test(`gives the file a distinct tree path for ${scenario}`, () => {
      const tree = changesTreeOf(files);
      const fileTreePath = tree.paths.find((path) => path.startsWith("lib/a") && !path.includes("/b.ts"));

      assert.ok(fileTreePath !== undefined && fileTreePath !== "lib/a");
      assert.doesNotThrow(() => new FileTree({ paths: tree.paths }));
      assert.equal(tree.filesByTreePath.get(fileTreePath)?.path, "lib/a");
      assert.equal(tree.filesByTreePath.get("lib/a/b.ts")?.path, "lib/a/b.ts");
      assert.deepEqual(
        tree.gitStatus.map((entry) => [tree.filesByTreePath.get(entry.path)?.path, entry.status]),
        files.map((file) => [file.path, file.changeKind]),
      );
    });
  }

  for (const [scenario, files] of [
    [
      "a real file already uses the suffixed path",
      [change("a", "deleted"), change("a/b.ts", "added"), change("a\u200b", "modified")],
    ],
    [
      "a real directory already uses the suffixed path",
      [change("a", "deleted"), change("a/b.ts", "added"), change("a\u200b/c.ts", "added")],
    ],
  ] as const) {
    test(`keeps every change on its own tree path when ${scenario}`, () => {
      const tree = changesTreeOf(files);

      assert.doesNotThrow(() => new FileTree({ paths: tree.paths }));
      assert.deepEqual([...tree.filesByTreePath.values()], files);
      assert.deepEqual(
        tree.gitStatus.map((entry) => [tree.filesByTreePath.get(entry.path)?.path, entry.status]),
        files.map((file) => [file.path, file.changeKind]),
      );
    });
  }

  test("keeps the real file's icon on a distinct tree path", () => {
    const tree = changesTreeOf([change("app/package.json", "deleted"), change("app/package.json/index.ts", "added")]);
    const [fileTreePath] = tree.paths;

    assert.notEqual(fileTreePath, "app/package.json");
    assert.deepEqual(
      createFileTreeIconResolver(tree.icons).resolveIcon("file-tree-icon-file", fileTreePath),
      createFileTreeIconResolver(TREE_ICONS).resolveIcon("file-tree-icon-file", "app/package.json"),
    );
  });
});

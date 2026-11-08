import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FileTree, createFileTreeIconResolver } from "@pierre/trees";
import type { DiffFile } from "../../../diff/diff-schema.ts";
import { diffFile } from "../diff-file.fixture.ts";
import { changesTreeOf } from "./tree-input.ts";

describe("changesTreeOf", () => {
  const change = (path: string, status: DiffFile["status"]): DiffFile => diffFile(path, { status });

  test("gives each file its status as the tree's git status", () => {
    const tree = changesTreeOf([
      change("a/added.ts", "added"),
      change("a/modified.ts", "modified"),
      change("a/deleted.ts", "deleted"),
      change("a/renamed.ts", "renamed"),
    ]);

    assert.deepEqual(tree.gitStatus, [
      { path: "a/added.ts", status: "added" },
      { path: "a/modified.ts", status: "modified" },
      { path: "a/deleted.ts", status: "deleted" },
      { path: "a/renamed.ts", status: "renamed" },
    ]);
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
        files.map((file) => [file.path, file.status]),
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
        files.map((file) => [file.path, file.status]),
      );
    });
  }

  test("decorates each changed row with its line stats in bb's diff colors", () => {
    const tree = changesTreeOf([
      diffFile("README.md", { added: 3, removed: 1 }),
      diffFile("notes.md", { status: "added", added: 4, removed: 0 }),
      diffFile("pixel.png", { binary: true, added: 0, removed: 0 }),
      diffFile("empty.txt", { status: "added", added: 0, removed: 0 }),
    ]);

    assert.deepEqual(tree.decorations.get("README.md"), {
      text: "+3 −1",
      title: "+3 −1",
      parts: [
        { text: "+3", color: "var(--diff-added)" },
        { text: "\u00a0" },
        { text: "−1", color: "var(--diff-removed)" },
      ],
    });
    assert.deepEqual(tree.decorations.get("notes.md"), {
      text: "+4",
      title: "+4",
      parts: [{ text: "+4", color: "var(--diff-added)" }],
    });
    assert.deepEqual(tree.decorations.get("pixel.png"), {
      text: "Binary",
      title: "Binary",
      parts: [{ text: "Binary", color: "var(--muted-foreground)" }],
    });
    assert.equal(tree.decorations.has("empty.txt"), false);
  });

  test("keeps the real file's icon on a distinct tree path", () => {
    const tree = changesTreeOf([change("app/package.json", "deleted"), change("app/package.json/index.ts", "added")]);
    const [fileTreePath] = tree.paths;
    const plainTree = changesTreeOf([change("app/package.json", "deleted")]);

    assert.notEqual(fileTreePath, "app/package.json");
    assert.deepEqual(
      createFileTreeIconResolver(tree.icons).resolveIcon("file-tree-icon-file", fileTreePath),
      createFileTreeIconResolver(plainTree.icons).resolveIcon("file-tree-icon-file", "app/package.json"),
    );
  });
});

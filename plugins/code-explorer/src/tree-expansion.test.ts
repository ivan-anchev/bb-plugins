import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FileTree } from "@pierre/trees";
import { collapseAllFolders, expandAllFolders, expandedDirectoriesOf, folderStateOf } from "./tree-expansion.ts";

const PATHS = ["src/app/main.ts", "src/app/view/row.tsx", "src/lib/util.ts", "docs/guide/intro.md", "README.md"];

function openTree(paths: readonly string[] = PATHS): FileTree {
  return new FileTree({ paths, initialExpansion: "open", flattenEmptyDirectories: true });
}

describe("folderStateOf", () => {
  test("reports expanded while any shown folder is open", () => {
    assert.equal(folderStateOf(openTree()), "expanded");
  });

  test("reports none for a tree of root files", () => {
    assert.equal(folderStateOf(openTree(["README.md", "LICENSE"])), "none");
  });
});

describe("collapseAllFolders", () => {
  test("closes every folder, nested ones included", () => {
    const tree = openTree();
    collapseAllFolders(tree);

    assert.equal(folderStateOf(tree), "collapsed");
    const src = tree.getItem("src/");
    if (src !== null && "expand" in src) src.expand();
    assert.deepEqual(expandedDirectoriesOf(tree), ["src/"]);
  });
});

describe("expandAllFolders", () => {
  test("opens every folder down to the deepest one", () => {
    const tree = new FileTree({ paths: PATHS, initialExpansion: "closed", flattenEmptyDirectories: true });
    expandAllFolders(tree);

    assert.deepEqual(expandedDirectoriesOf(tree), ["docs/guide/", "src/", "src/app/", "src/app/view/", "src/lib/"]);
  });
});

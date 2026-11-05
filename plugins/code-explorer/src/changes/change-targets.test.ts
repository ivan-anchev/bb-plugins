import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WorkspaceStatus } from "../git.ts";
import { DEFAULT_TARGET, changeTargetOf, offeredTargetOf, targetOptionsOf } from "./change-targets.ts";

const COMMITS = [
  { sha: "de28784aaaa", shortSha: "de28784", subject: "Add file-tree plugin" },
  { sha: "80b39a9bbbb", shortSha: "80b39a9", subject: "Show the selected file" },
];

function workspace({ fileCount = 0, commits = COMMITS, mergeBase = true } = {}): WorkspaceStatus {
  return {
    workingTree: { fileCount },
    branch: { defaultBranch: "trunk" },
    mergeBase: mergeBase ? { mergeBaseBranch: "main", commits } : null,
  };
}

const labelsOf = (status: WorkspaceStatus) =>
  targetOptionsOf(status).map((option) => [option.monoPrefix, option.label]);

describe("targetOptionsOf", () => {
  test("lists bb's targets in bb's order when there are commits and uncommitted changes", () => {
    assert.deepEqual(labelsOf(workspace({ fileCount: 3 })), [
      [null, "All changes"],
      [null, "Committed changes"],
      [null, "Uncommitted changes"],
      ["de28784", "Add file-tree plugin"],
      ["80b39a9", "Show the selected file"],
    ]);
  });

  test("offers only All changes when the branch has neither commits nor local changes", () => {
    assert.deepEqual(labelsOf(workspace({ commits: [] })), [[null, "All changes"]]);
  });

  test("drops Committed changes when the branch has no commits of its own", () => {
    assert.deepEqual(labelsOf(workspace({ fileCount: 1, commits: [] })), [
      [null, "All changes"],
      [null, "Uncommitted changes"],
    ]);
  });
});

describe("offeredTargetOf", () => {
  test("keeps a choice that is still offered", () => {
    const options = targetOptionsOf(workspace({ fileCount: 1 }));
    assert.equal(offeredTargetOf({ kind: "commit", sha: "80b39a9bbbb" }, options).label, "Show the selected file");
  });

  test("falls back to All changes when the chosen target is gone", () => {
    const options = targetOptionsOf(workspace({ fileCount: 0 }));
    assert.equal(offeredTargetOf({ kind: "uncommitted" }, options).label, "All changes");
  });
});

describe("changeTargetOf", () => {
  test("compares against the merge-base branch", () => {
    assert.deepEqual(changeTargetOf(DEFAULT_TARGET, workspace()), { type: "all", mergeBaseBranch: "main" });
    assert.deepEqual(changeTargetOf({ kind: "branch_committed" }, workspace()), {
      type: "branch_committed",
      mergeBaseBranch: "main",
    });
  });

  test("falls back to the default branch when there is no merge base", () => {
    assert.deepEqual(changeTargetOf(DEFAULT_TARGET, workspace({ mergeBase: false })), {
      type: "all",
      mergeBaseBranch: "trunk",
    });
  });

  test("maps uncommitted and commit choices to their bb--git targets", () => {
    assert.deepEqual(changeTargetOf({ kind: "uncommitted" }, workspace()), { type: "uncommitted" });
    assert.deepEqual(changeTargetOf({ kind: "commit", sha: "de28784aaaa" }, workspace()), {
      type: "commit",
      sha: "de28784aaaa",
    });
  });
});

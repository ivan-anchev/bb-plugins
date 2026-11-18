import assert from "node:assert/strict";
import { test } from "node:test";
import { repoSchema } from "./repo.ts";
import { mergeArgs, stateChangeArgs } from "./state-args.ts";

const REPO = repoSchema.parse("octo-org/widgets");

test("each state change runs its gh pr command on the PR by number, in the project's repo", () => {
  assert.deepEqual(stateChangeArgs(REPO, 42, "ready"), ["pr", "ready", "42", "-R", "octo-org/widgets"]);
  assert.deepEqual(stateChangeArgs(REPO, 42, "draft"), ["pr", "ready", "42", "--undo", "-R", "octo-org/widgets"]);
  assert.deepEqual(stateChangeArgs(REPO, 42, "close"), ["pr", "close", "42", "-R", "octo-org/widgets"]);
  assert.deepEqual(stateChangeArgs(REPO, 42, "reopen"), ["pr", "reopen", "42", "-R", "octo-org/widgets"]);
});

test("a merge runs gh pr merge by its method, only while the PR's head is the one the reader saw", () => {
  const head = "ec618b08a91e3f5e179ba46d1e43c6f6aeddfb53";
  assert.deepEqual(mergeArgs(REPO, 42, "merge", head), ["pr", "merge", "42", "--merge", "--match-head-commit", head, "-R", "octo-org/widgets"]);
  assert.deepEqual(mergeArgs(REPO, 42, "squash", head), ["pr", "merge", "42", "--squash", "--match-head-commit", head, "-R", "octo-org/widgets"]);
  assert.deepEqual(mergeArgs(REPO, 42, "rebase", head), ["pr", "merge", "42", "--rebase", "--match-head-commit", head, "-R", "octo-org/widgets"]);
});

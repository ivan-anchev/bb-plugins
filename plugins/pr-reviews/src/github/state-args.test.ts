import assert from "node:assert/strict";
import { test } from "node:test";
import { repoSchema } from "./repo.ts";
import { stateChangeArgs } from "./state-args.ts";

const REPO = repoSchema.parse("octo-org/widgets");

test("each state change runs its gh pr command on the PR by number, in the project's repo", () => {
  assert.deepEqual(stateChangeArgs(REPO, 42, "ready"), ["pr", "ready", "42", "-R", "octo-org/widgets"]);
  assert.deepEqual(stateChangeArgs(REPO, 42, "draft"), ["pr", "ready", "42", "--undo", "-R", "octo-org/widgets"]);
  assert.deepEqual(stateChangeArgs(REPO, 42, "close"), ["pr", "close", "42", "-R", "octo-org/widgets"]);
  assert.deepEqual(stateChangeArgs(REPO, 42, "reopen"), ["pr", "reopen", "42", "-R", "octo-org/widgets"]);
});

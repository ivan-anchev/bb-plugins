import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutReadOf, gitStatusOf, type GitStatusBb } from "./git-status.ts";

/** bb's git plugin answering `status` for every key with `row`, parsed with the caller's schema as bb's callRpc does. */
const answering = (row: object): GitStatusBb => ({
  sdk: { plugins: { callRpc: async ({ input, outputSchema }) => outputSchema.parse(Object.fromEntries(input.keys.map((key) => [key, row]))) } },
});

// As bb 0.49's git plugin answered for a detached checkout whose only named branch was deleted, with one untracked file.
const DETACHED_NO_BRANCH = {
  outcome: "available",
  workspace: {
    workingTree: { insertions: 1, deletions: 0, lineStatsComplete: true, fileCount: 1, hasUncommittedChanges: true, state: "untracked", files: [{ path: "dirty", status: "??", insertions: 1, deletions: 0 }] },
    branch: { currentBranch: null, defaultBranch: "" },
    checkout: { kind: "detached", headSha: "5ed406cc5400e3a633e02f5c8eaf334e31658cd2" },
    mergeBase: null,
    allChanges: { insertions: 1, deletions: 0, lineStatsComplete: true, fileCount: 1 },
  },
};

test("a checkout bb's git plugin names no default branch for reads whole, with none named", async () => {
  const status = await gitStatusOf(answering(DETACHED_NO_BRANCH), "env_1");
  assert.deepEqual(status, { kind: "read", branch: null, headSha: "5ed406cc5400e3a633e02f5c8eaf334e31658cd2", changedFiles: [{ path: "dirty", status: "??" }], changedFileCount: 1, defaultBranch: null });
  assert.equal(checkoutReadOf(status).kind, "read", "an agent's handoff reads its checkout too");
});

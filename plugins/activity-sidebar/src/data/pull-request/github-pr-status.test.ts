import assert from "node:assert/strict";
import { test } from "node:test";
import { shownPullRequest } from "./github-pr-status.ts";

const pr = { number: 12, title: "Fix the login flow", url: "https://github.com/o/r/pull/12", state: "open" } as const;

test("an available pull request is shown", () => {
  assert.deepEqual(shownPullRequest({ outcome: "available", pullRequest: pr }), pr);
  for (const state of ["draft", "merged", "closed"] as const) {
    assert.equal(shownPullRequest({ outcome: "available", pullRequest: { ...pr, state } })?.state, state);
  }
});

test("no pull request, an unavailable one, or one not read yet shows nothing", () => {
  assert.equal(shownPullRequest({ outcome: "absent" }), null);
  assert.equal(shownPullRequest({ outcome: "unavailable", message: "gh pr view failed" }), null);
  assert.equal(shownPullRequest(undefined), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { problemsOf, type Failure } from "./box-problems.ts";

const REFUSED: Failure = { action: "comment", message: "GitHub has no such pull request, or your account can't see it.", draft: "Ship it" };
const TOO_LONG = "This comment is 66,000 characters, and GitHub takes at most 65,536. Shorten it, or select fewer lines.";
const GONE = "Commit 055a799 is no longer in the PR (force-pushed).";

test("a failure shows while its draft is the draft, and goes once the draft changes", () => {
  assert.deepEqual(problemsOf(null, REFUSED, "Ship it"), [REFUSED.message]);
  assert.deepEqual(problemsOf(null, REFUSED, "Ship it now"), []);
});

test("a block on the draft as it is now replaces a failed comment", () => {
  assert.deepEqual(problemsOf(TOO_LONG, REFUSED, "x".repeat(66_000)), [TOO_LONG], "the draft grew too long after a refusal");
  assert.deepEqual(problemsOf(GONE, REFUSED, "Ship it"), [GONE], "the commit went while the refused draft stayed the same");
});

test("a failed question stays beside a block, which is about commenting", () => {
  const asked: Failure = { ...REFUSED, action: "ask", message: "The review thread didn't take the message." };
  assert.deepEqual(problemsOf(GONE, asked, "Ship it"), [GONE, asked.message]);
});

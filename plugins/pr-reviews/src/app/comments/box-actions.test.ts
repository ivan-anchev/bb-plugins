import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewerReview } from "../../comments/review-schema.ts";
import { githubActionsOf } from "./box-actions.ts";

const REVIEWER: ViewerReview = { author: false, pendingReviewId: null };
const AUTHOR: ViewerReview = { author: true, pendingReviewId: null };
const PENDING: ViewerReview = { author: false, pendingReviewId: "PRR_1" };

test("a reviewer on lines at the PR's head can comment at once or start a review", () => {
  assert.deepEqual(githubActionsOf("lines", REVIEWER, true), { kind: "both" });
});

test("the PR's author, lines on an older commit, a reply and the conversation only post, as before", () => {
  assert.deepEqual(githubActionsOf("lines", AUTHOR, true), { kind: "publish" });
  assert.deepEqual(githubActionsOf("lines", REVIEWER, false), { kind: "publish" }, "GitHub puts a review comment on the head");
  assert.deepEqual(githubActionsOf("reply", REVIEWER, true), { kind: "publish" });
  assert.deepEqual(githubActionsOf("conversation", REVIEWER, true), { kind: "publish" });
});

test("until the reader's review is read, the box posts as it always has", () => {
  assert.deepEqual(githubActionsOf("lines", undefined, true), { kind: "publish" });
});

test("with a pending review, lines and replies go only into it, which GitHub requires, whoever the reader is", () => {
  const review = { kind: "review", reviewId: "PRR_1" };
  assert.deepEqual(githubActionsOf("lines", PENDING, true), review);
  assert.deepEqual(githubActionsOf("lines", PENDING, false), review, "and the box says why it can't take these lines");
  assert.deepEqual(githubActionsOf("reply", PENDING, true), review);
  assert.deepEqual(githubActionsOf("lines", { ...PENDING, author: true }, true), review);
  assert.deepEqual(githubActionsOf("conversation", PENDING, true), { kind: "publish" }, "a conversation comment is never in a review");
});

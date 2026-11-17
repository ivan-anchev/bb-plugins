import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewerReview } from "../../comments/review-schema.ts";
import { descriptionOf, githubActionsOf, placeholderOf, sendOptionsOf, selectedOf, sendLabelOf, type GitHubActions, type SendOption } from "./box-actions.ts";

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

const PUBLISH: GitHubActions = { kind: "publish" };
const BOTH: GitHubActions = { kind: "both" };
const IN_REVIEW: GitHubActions = { kind: "review", reviewId: "PRR_1" };

// Each option as `mode`, or `mode!` when it can't send.
const shown = (options: readonly SendOption[]) => options.map(({ mode, reason }) => (reason === null ? mode : `${mode}!`));
const reasonOf = (options: readonly SendOption[], mode: string) => options.find((option) => option.mode === mode)?.reason;

test("Send as shows Ask and Comment, and Review while the reader can start a review or has one", () => {
  assert.deepEqual(shown(sendOptionsOf("lines", PUBLISH, true, true)), ["ask", "comment"]);
  assert.deepEqual(shown(sendOptionsOf("lines", BOTH, true, true)), ["ask", "comment", "review"]);
  assert.deepEqual(shown(sendOptionsOf("lines", IN_REVIEW, true, true)), ["ask", "comment!", "review"]);
  assert.deepEqual(shown(sendOptionsOf("reply", IN_REVIEW, true, true)), ["ask", "comment!", "review"]);
});

test("an option that can't send says why", () => {
  const noAgentReview = sendOptionsOf("lines", BOTH, false, true);
  assert.deepEqual(shown(noAgentReview), ["ask!", "comment", "review"]);
  assert.equal(reasonOf(noAgentReview, "ask"), "Start an agent review to ask about these lines.");
  const pending = sendOptionsOf("lines", IN_REVIEW, true, true);
  assert.equal(reasonOf(pending, "comment"), "GitHub holds new comments while your review is pending. Add this to the review instead.");
  const olderCommit = sendOptionsOf("lines", IN_REVIEW, true, false);
  assert.deepEqual(shown(olderCommit), ["ask", "comment!", "review!"]);
  assert.equal(reasonOf(olderCommit, "review"), "Your review takes comments on the PR's latest commit only. Refresh, then comment from the Changes tab.");
});

test("the conversation has Comment alone, which never waits on a review or the agent", () => {
  assert.deepEqual(shown(sendOptionsOf("conversation", PUBLISH, false, true)), ["comment"]);
  assert.deepEqual(shown(sendOptionsOf("conversation", IN_REVIEW, false, false)), ["comment"]);
});

test("a box sends as Comment, or Review while a review is pending, until the reader picks", () => {
  assert.equal(selectedOf(sendOptionsOf("lines", BOTH, true, true), BOTH, null).mode, "comment");
  assert.equal(selectedOf(sendOptionsOf("lines", PUBLISH, true, true), PUBLISH, null).mode, "comment");
  assert.equal(selectedOf(sendOptionsOf("lines", IN_REVIEW, true, true), IN_REVIEW, null).mode, "review");
  assert.equal(selectedOf(sendOptionsOf("conversation", PUBLISH, true, true), PUBLISH, "ask").mode, "comment");
});

test("the reader's pick holds in every box where it can send, and gives way where it can't", () => {
  assert.equal(selectedOf(sendOptionsOf("lines", BOTH, true, true), BOTH, "review").mode, "review");
  assert.equal(selectedOf(sendOptionsOf("lines", BOTH, true, true), BOTH, "ask").mode, "ask");
  assert.equal(selectedOf(sendOptionsOf("lines", PUBLISH, true, true), PUBLISH, "review").mode, "comment", "the author has no Review");
  assert.equal(selectedOf(sendOptionsOf("lines", IN_REVIEW, true, true), IN_REVIEW, "comment").mode, "review", "Comment waits on the review");
  assert.equal(selectedOf(sendOptionsOf("lines", BOTH, false, true), BOTH, "ask").mode, "comment", "no agent review to ask");
});

test("when the default can't send either, the box sends as the first option that can", () => {
  assert.equal(selectedOf(sendOptionsOf("lines", IN_REVIEW, true, false), IN_REVIEW, null).mode, "ask");
  assert.equal(selectedOf(sendOptionsOf("lines", IN_REVIEW, false, false), IN_REVIEW, null).mode, "ask", "with none that can, the first");
});

test("the send button and the placeholder name what the draft goes as", () => {
  assert.deepEqual(
    (["ask", "comment", "review"] as const).map((mode) => [sendLabelOf("lines", mode), placeholderOf("lines", mode)]),
    [
      ["Ask the agent", "Ask the agent about these lines"],
      ["Comment", "Leave a comment on GitHub"],
      ["Add to review", "Add a comment to your review"],
    ],
  );
  assert.deepEqual(
    (["ask", "comment", "review"] as const).map((mode) => [sendLabelOf("reply", mode), placeholderOf("reply", mode)]),
    [
      ["Ask the agent", "Ask the agent about this thread"],
      ["Reply", "Reply on GitHub"],
      ["Add to review", "Add a reply to your review"],
    ],
  );
  assert.deepEqual([sendLabelOf("conversation", "comment"), placeholderOf("conversation", "comment")], ["Comment", "Comment on this pull request"]);
});

test("the Send as menu says Review joins the pending review, or starts one", () => {
  assert.match(descriptionOf("review", IN_REVIEW), /^Joins your pending review/);
  assert.match(descriptionOf("review", BOTH), /^Starts a pending review/);
});

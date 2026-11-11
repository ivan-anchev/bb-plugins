// Which of the comment box's GitHub actions the reader has: posting at once (Comment or Reply), or
// adding to their pending review, which GitHub publishes only when they submit it. Pure.
import type { ViewerReview } from "../../comments/review-schema.ts";

/**
 * `publish`: Comment or Reply alone. `both`: a reviewer on lines can comment at once or start a
 * pending review (Add to review). `review`: with a pending review open, Add to review alone, into
 * `reviewId`: GitHub refuses a comment or reply on its own then, as GitHub.com offers only the
 * review.
 */
export type GitHubActions = { kind: "publish" } | { kind: "both" } | { kind: "review"; reviewId: string };

/**
 * `viewer`: the reader's review, from the comments read; undefined until it is read, when the box
 * posts as it always has. `atHead`: the box's lines are on the PR's latest commit, where GitHub
 * puts a review comment.
 */
export function githubActionsOf(subject: "lines" | "reply" | "conversation", viewer: ViewerReview | undefined, atHead: boolean): GitHubActions {
  if (subject === "conversation" || viewer === undefined) return { kind: "publish" };
  if (viewer.pendingReviewId !== null) return { kind: "review", reviewId: viewer.pendingReviewId };
  return subject === "lines" && !viewer.author && atHead ? { kind: "both" } : { kind: "publish" };
}

/** Why Add to review can't take lines on an older commit, while it is the only action. */
export const NOT_AT_HEAD = "Your review takes comments on the PR's latest commit only. Refresh, then comment from the Changes tab.";

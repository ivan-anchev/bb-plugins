// The reader's pending review through GitHub's GraphQL API: the read of it, and the mutations that
// add a comment or a reply to it, submit it and discard it, as `gh api graphql` arguments, with
// the parses of their responses. gh.ts runs them. Pure.
import { z } from "zod";
import { githubSideOf, type CommentRequest } from "../comments/comment-schema.ts";
import type { ReviewEvent, ViewerReview } from "../comments/review-schema.ts";
import { graphqlArgs, prVariables, pullRequestOf } from "./pr-comments.ts";
import type { Repo } from "./repo.ts";

const PR_ONLY = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {";

// GitHub shows a reader only their own pending review, so the first PENDING one is theirs.
const VIEWER_REVIEW_QUERY = `${PR_ONLY} viewerDidAuthor reviews(states: [PENDING], first: 1) { nodes { id } } } } }`;

export const viewerReviewArgs = (repo: Repo, number: number) => graphqlArgs(VIEWER_REVIEW_QUERY, prVariables(repo, number));

export function parseViewerReview(json: unknown): ViewerReview {
  const pr = pullRequestOf({ viewerDidAuthor: z.boolean(), reviews: z.object({ nodes: z.array(z.object({ id: z.string() })) }) }).parse(json).data.repository.pullRequest;
  return { author: pr.viewerDidAuthor, pendingReviewId: pr.reviews.nodes[0]?.id ?? null };
}

/** The PR's node id, which the mutations name it by, and its head: the commit a new thread goes on. */
const PR_NODE_QUERY = `${PR_ONLY} id headRefOid } } }`;

export const prNodeArgs = (repo: Repo, number: number) => graphqlArgs(PR_NODE_QUERY, prVariables(repo, number));

export const parsePrNode = (json: unknown) => pullRequestOf({ id: z.string(), headRefOid: z.string() }).parse(json).data.repository.pullRequest;

// why no commit: GitHub puts a new thread on the PR's head. `review` null joins the reader's pending
// review, or starts one.
const ADD_THREAD = `mutation($pr: ID!, $review: ID, $path: String!, $body: String!, $line: Int, $side: DiffSide, $startLine: Int, $startSide: DiffSide, $subjectType: PullRequestReviewThreadSubjectType) {
  addPullRequestReviewThread(input: { pullRequestId: $pr, pullRequestReviewId: $review, path: $path, body: $body, line: $line, side: $side, startLine: $startLine, startSide: $startSide, subjectType: $subjectType }) { thread { id } } }`;

/** A line or file comment as a new thread in the pending review `reviewId`, or in the reader's pending review, started if they have none (null). */
export function addThreadArgs(pullRequestId: string, reviewId: string | null, request: CommentRequest): string[] {
  const common = { pr: pullRequestId, review: reviewId, path: request.path, body: request.body };
  switch (request.kind) {
    case "line": {
      const { start, end } = request;
      return graphqlArgs(ADD_THREAD, {
        ...common,
        line: end.line,
        side: githubSideOf(end.side),
        startLine: start?.line ?? null,
        startSide: start === null ? null : githubSideOf(start.side),
      });
    }
    case "file":
      return graphqlArgs(ADD_THREAD, { ...common, subjectType: "FILE" });
    default:
      return request satisfies never;
  }
}

/**
 * Whether GitHub placed the thread. It answers a line it can't place with no thread and no error,
 * having still started the pending review.
 */
export const parseAddedThread = (json: unknown): boolean =>
  z.object({ data: z.object({ addPullRequestReviewThread: z.object({ thread: z.object({ id: z.string() }).nullable() }) }) }).parse(json).data.addPullRequestReviewThread.thread !== null;

// why a review id is required: without one, GitHub publishes the reply at once when the reader has
// no pending review, as when it was submitted elsewhere since the page read it.
const ADD_REPLY = `mutation($thread: ID!, $review: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, pullRequestReviewId: $review, body: $body }) { comment { id } } }`;

/** A reply in the review thread `threadId` (its node id), in the pending review `reviewId`. */
export const addReplyArgs = (threadId: string, reviewId: string, body: string) => graphqlArgs(ADD_REPLY, { thread: threadId, review: reviewId, body });

const SUBMIT = `mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { id } } }`;

/** Submits the pending review as `event`, with `body` ("" for none) as its summary. */
export const submitArgs = (reviewId: string, event: ReviewEvent, body: string) => graphqlArgs(SUBMIT, { review: reviewId, event, body });

const DISCARD = "mutation($review: ID!) { deletePullRequestReview(input: { pullRequestReviewId: $review }) { pullRequestReview { id } } }";

/** Deletes the pending review and every comment in it. */
export const discardArgs = (reviewId: string) => graphqlArgs(DISCARD, { review: reviewId });

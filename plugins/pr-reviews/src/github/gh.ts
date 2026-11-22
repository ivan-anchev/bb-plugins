import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CommentRequest } from "../comments/comment-schema.ts";
import type { ReviewEvent } from "../comments/review-schema.ts";
import type { ReviewThread } from "../comments/thread-schema.ts";
import type { PrComments } from "../comments/timeline-schema.ts";
import { MERGE_METHODS, type MergeMethod, type PrDetail, type PrSummary, type StateChange } from "../contract.ts";
import { statusCheckRollupSchema } from "./checks.ts";
import { commentApiArgs, conversationCommentApiArgs, replyApiArgs } from "./comment-args.ts";
import { ghPostRefusalFor, ghRefusalFor, ghStateRefusalFor } from "./gh-refusal.ts";
import { ghLabelSchema } from "./label.ts";
import { parseHostCommandFailure, runHostCommand } from "./host-command.ts";
import { INBOX_QUERY, inboxVariables, parseInboxSearch, parseStackContext, stackContextQuery, type FoundPr, type GitHubPr } from "./inbox-search.ts";
import { addReplyArgs, addReviewArgs, addThreadArgs, discardArgs, parseAddedThread, parsePrNode, parseViewerReview, prNodeArgs, submitArgs, viewerReviewArgs } from "./pending-review.ts";
import type { PrCommits } from "./pr-commits.ts";
import {
  allPages,
  CHANGED_PATHS_QUERY,
  graphqlArgs,
  liveComments,
  parseChangedPathsPage,
  parseThreadCommentsPage,
  parseThreadsPage,
  prVariables,
  THREAD_COMMENTS_QUERY,
  THREADS_QUERY,
  toThread,
} from "./pr-comments.ts";
import { isReview, parseReviewCommentsPage, parseTimelinePage, REVIEW_COMMENTS_QUERY, TIMELINE_QUERY, toTimeline, type GhTimelineNode } from "./pr-timeline.ts";
import type { Repo } from "./repo.ts";
import { latestReviewsSchema, reviewRequestsSchema, toReviewers } from "./reviewers.ts";
import { mergeArgs, stateChangeArgs } from "./state-args.ts";

const LIST_LIMIT = 200;
const SUMMARY_FIELDS = ["number", "title", "author", "updatedAt", "headRefOid"];
const DETAIL_FIELDS = [...SUMMARY_FIELDS, "createdAt", "body", "url", "headRefName", "baseRefName", "state", "isDraft", "commits", "additions", "deletions", "statusCheckRollup", "reviewRequests", "latestReviews", "labels", "mergeable"];

const ghSummarySchema = z.object({
  number: z.number(),
  title: z.string(),
  author: z.object({ login: z.string() }),
  updatedAt: z.string(),
  headRefOid: z.string(),
});

const toSummary = (pr: z.infer<typeof ghSummarySchema>): PrSummary => ({
  number: pr.number,
  title: pr.title,
  author: pr.author.login,
  updatedAt: pr.updatedAt,
  headSha: pr.headRefOid,
});

const ghDetailSchema = ghSummarySchema.extend({
  createdAt: z.string(),
  body: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  commits: z.array(z.object({ oid: z.string() })),
  additions: z.number(),
  deletions: z.number(),
  statusCheckRollup: statusCheckRollupSchema,
  reviewRequests: reviewRequestsSchema,
  latestReviews: latestReviewsSchema,
  labels: z.array(ghLabelSchema),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
});

const ALLOWED_FIELDS = { merge: "mergeCommitAllowed", squash: "squashMergeAllowed", rebase: "rebaseMergeAllowed" } as const satisfies Record<MergeMethod, string>;
const ghMergeSettingsSchema = z.record(z.enum(Object.values(ALLOWED_FIELDS)), z.boolean());

const toDetail = (pr: z.infer<typeof ghDetailSchema>, settings: z.infer<typeof ghMergeSettingsSchema>): PrDetail => ({
  ...toSummary(pr),
  createdAt: pr.createdAt,
  body: pr.body,
  url: pr.url,
  headRefName: pr.headRefName,
  baseRefName: pr.baseRefName,
  state: pr.state === "OPEN" && pr.isDraft ? "DRAFT" : pr.state,
  commits: pr.commits.map((commit) => commit.oid),
  additions: pr.additions,
  deletions: pr.deletions,
  checks: pr.statusCheckRollup,
  reviewers: toReviewers(pr.reviewRequests, pr.latestReviews),
  labels: pr.labels,
  mergeMethods: MERGE_METHODS.filter((method) => settings[ALLOWED_FIELDS[method]]),
  conflicting: pr.mergeable === "CONFLICTING",
});

/** `gh pr view --json` output for DETAIL_FIELDS and its repo's `gh repo view --json` merge settings, as the canonical PR. */
export const parsePrDetail = (pr: unknown, settings: unknown): PrDetail => toDetail(ghDetailSchema.parse(pr), ghMergeSettingsSchema.parse(settings));

export async function listOpenPrs(repo: Repo): Promise<PrSummary[]> {
  const json = await runGh(["pr", "list", "-R", repo, "--state", "open", "--limit", String(LIST_LIMIT), "--json", SUMMARY_FIELDS.join(",")]);
  return z.array(ghSummarySchema).parse(JSON.parse(json)).map(toSummary);
}

/**
 * The PRs the sidebar's searches find in `repos` at `now` (epoch ms), and the open and recently
 * merged PRs of the repos they are in, which hold their stack-mates. Two gh calls at most.
 */
export async function readInbox(repos: Repo[], now: number): Promise<{ found: FoundPr[]; stackMates: GitHubPr[] }> {
  if (repos.length === 0) return { found: [], stackMates: [] };
  const found = parseInboxSearch(await graphql(INBOX_QUERY, inboxVariables(repos, now)), now);
  const foundRepos = [...new Set(found.map(({ pr }) => pr.repo))];
  if (foundRepos.length === 0) return { found, stackMates: [] };
  return { found, stackMates: parseStackContext(await graphql(stackContextQuery(foundRepos), {})) };
}

export async function viewPr(repo: Repo, number: number): Promise<PrDetail> {
  const [pr, settings] = await Promise.all([
    runGh(["pr", "view", String(number), "-R", repo, "--json", DETAIL_FIELDS.join(",")]),
    runGh(["repo", "view", repo, "--json", Object.values(ALLOWED_FIELDS).join(",")]),
  ]);
  return parsePrDetail(JSON.parse(pr), JSON.parse(settings));
}

/** A PR's diff between the two commits it was read at. */
export type PrDiffSnapshot = PrCommits & { diff: string };

export async function snapshotPrDiff(repo: Repo, number: number): Promise<PrDiffSnapshot> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await commitsOf(repo, number);
    const diff = await runGh(["pr", "diff", String(number), "-R", repo, "--color", "never"]);
    const after = await commitsOf(repo, number);
    if (after.headSha === before.headSha && after.baseSha === before.baseSha) return { ...before, diff };
  }
  throw new Refusal({ code: "conflict", message: "The PR is being pushed to right now. Try again in a moment." });
}

const ghFileSchema = z.object({ encoding: z.string(), content: z.string() });

/** The text of the file at `path` in commit `sha`. Refuses a file over GitHub's 1 MB limit. */
export async function readFileAt(repo: Repo, sha: string, path: string): Promise<string> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const json = await runGh(["api", `repos/${repo}/contents/${encodedPath}?ref=${sha}`]);
  const file = ghFileSchema.parse(JSON.parse(json));
  if (file.encoding !== "base64") throw new Refusal({ code: "invalid", message: "The file is too large for GitHub to serve whole." });
  return Buffer.from(file.content, "base64").toString("utf8");
}

/** Every review thread on the PR, every item of its timeline and the paths it changes, all pages of each, and the reader's own review. */
export async function readPrComments(repo: Repo, number: number): Promise<PrComments> {
  const [threads, nodes, changedPaths, viewer] = await Promise.all([
    reviewThreadsOf(repo, number),
    timelineOf(repo, number),
    changedPathsOf(repo, number),
    graphqlRead(viewerReviewArgs(repo, number)).then(parseViewerReview),
  ]);
  return { threads, timeline: toTimeline(nodes, await reviewCommentsOf(nodes), threads), changedPaths, viewer };
}

async function changedPathsOf(repo: Repo, number: number): Promise<string[]> {
  const pr = prVariables(repo, number);
  const files = await allPages(null, async (cursor) => parseChangedPathsPage(await graphql(CHANGED_PATHS_QUERY, { ...pr, cursor })));
  return files.map((file) => file.path);
}

async function reviewThreadsOf(repo: Repo, number: number): Promise<ReviewThread[]> {
  const pr = prVariables(repo, number);
  const threads = await allPages(null, async (cursor) => parseThreadsPage(await graphql(THREADS_QUERY, { ...pr, cursor })));
  const read = await Promise.all(
    threads.map(async (thread) => {
      const comments = liveComments(await allPages(thread.comments, async (cursor) => parseThreadCommentsPage(await graphql(THREAD_COMMENTS_QUERY, { id: thread.id, cursor }))));
      return comments.length === 0 ? [] : [toThread(thread, comments)];
    }),
  );
  return read.flat();
}

async function timelineOf(repo: Repo, number: number): Promise<GhTimelineNode[]> {
  const pr = prVariables(repo, number);
  return allPages(null, async (cursor) => parseTimelinePage(await graphql(TIMELINE_QUERY, { ...pr, cursor })));
}

async function reviewCommentsOf(nodes: GhTimelineNode[]): Promise<Map<string, number[]>> {
  const reviews = await Promise.all(
    nodes.filter(isReview).map(async (review): Promise<[string, number[]]> => {
      const comments = await allPages(review.comments, async (cursor) => parseReviewCommentsPage(await graphql(REVIEW_COMMENTS_QUERY, { id: review.id, cursor })));
      return [review.id, comments.map((comment) => comment.databaseId)];
    }),
  );
  return new Map(reviews);
}

const graphql = async (query: string, variables: Record<string, string | number | null>): Promise<unknown> => graphqlRead(graphqlArgs(query, variables));

const graphqlRead = async (args: string[]): Promise<unknown> => JSON.parse(await runGh(args));

async function commitsOf(repo: Repo, number: number): Promise<PrCommits> {
  const json = await runGh(["pr", "view", String(number), "-R", repo, "--json", "headRefOid,baseRefOid"]);
  const { headRefOid, baseRefOid } = z.object({ headRefOid: z.string(), baseRefOid: z.string() }).parse(JSON.parse(json));
  return { headSha: headRefOid, baseSha: baseRefOid };
}

async function runGh(args: string[]): Promise<string> {
  try {
    return await runHostCommand("gh", args);
  } catch (error) {
    throw ghRefusalFor(parseHostCommandFailure(error));
  }
}

const postedCommentSchema = z.object({ html_url: z.string() });

/** Posts the review comment exactly as requested. Resolves to its page on GitHub. */
export const postComment = (repo: Repo, number: number, request: CommentRequest) => post(commentApiArgs(repo, number, request));

/** Posts a reply in the review thread that `commentId`, its first comment, opens. */
export const postReply = (repo: Repo, number: number, commentId: number, body: string) => post(replyApiArgs(repo, number, commentId, body));

/** Posts a comment on the PR's conversation, on no file. */
export const postConversationComment = (repo: Repo, number: number, body: string) => post(conversationCommentApiArgs(repo, number, body));

async function post(args: string[]): Promise<{ url: string }> {
  return { url: postedCommentSchema.parse(JSON.parse(await runGhPost(args))).html_url };
}

const ADDED_UNSURE = "The comment may have been added to your review: Refresh before adding it again.";

/**
 * Adds a line or file comment to the reader's pending review (`reviewId`), or to one GitHub starts
 * for it (null). GitHub puts it on the PR's head, so a comment on another commit is refused.
 */
export async function addReviewComment(repo: Repo, number: number, request: CommentRequest, reviewId: string | null): Promise<void> {
  const pr = parsePrNode(await graphqlRead(prNodeArgs(repo, number)));
  if (pr.headRefOid !== request.commit) {
    throw new Refusal({ code: "conflict", message: "The pull request has new commits since you read it. Refresh, then add your comment to the review." });
  }
  const placed = parseAddedThread(JSON.parse(await runGhPost(addThreadArgs(pr.id, reviewId, request), ADDED_UNSURE)));
  if (!placed) throw new Refusal({ code: "invalid", message: "GitHub couldn't place a comment on these lines, so it isn't in your review. Refresh, then select the lines again." });
}

/** Adds a reply in the review thread `threadId` to the pending review `reviewId`. */
export async function addReviewReply(threadId: string, reviewId: string, body: string): Promise<void> {
  await runGhPost(addReplyArgs(threadId, reviewId, body), ADDED_UNSURE);
}

const SUBMITTED_UNSURE = "The review may have been submitted: Refresh before submitting it again.";

/**
 * Submits the reader's pending review `reviewId` as `event`, with `body` ("" for none) as its
 * summary; with none pending (null), submits a new review of the PR with no comments.
 */
export async function submitReview(repo: Repo, number: number, reviewId: string | null, event: ReviewEvent, body: string): Promise<void> {
  if (reviewId !== null) {
    await runGhPost(submitArgs(reviewId, event, body), SUBMITTED_UNSURE);
    return;
  }
  const pr = parsePrNode(await graphqlRead(prNodeArgs(repo, number)));
  await runGhPost(addReviewArgs(pr.id, event, body), SUBMITTED_UNSURE);
}

/** Deletes the pending review `reviewId` and its comments. */
export async function discardReview(reviewId: string): Promise<void> {
  await runGhPost(discardArgs(reviewId), "The review may have been discarded: Refresh to see.");
}

async function runGhPost(args: string[], unsure?: string): Promise<string> {
  try {
    return await runHostCommand("gh", args);
  } catch (error) {
    throw ghPostRefusalFor(parseHostCommandFailure(error), unsure);
  }
}

/** Makes the state change as the reader's account. A PR already in the state it leads to is left as it is. */
export async function changePrState(repo: Repo, number: number, change: StateChange): Promise<void> {
  try {
    await runHostCommand("gh", stateChangeArgs(repo, number, change));
  } catch (error) {
    throw ghStateRefusalFor(parseHostCommandFailure(error));
  }
}

/** Merges the PR by `method` as the reader's account, only while its head is still `headSha`. */
export async function mergePr(repo: Repo, number: number, method: MergeMethod, headSha: string): Promise<void> {
  try {
    await runHostCommand("gh", mergeArgs(repo, number, method, headSha));
  } catch (error) {
    throw ghStateRefusalFor(parseHostCommandFailure(error));
  }
}

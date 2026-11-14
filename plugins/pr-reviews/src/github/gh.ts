// The only module that runs `gh`. It parses gh's JSON once into the canonical PR types, reads the
// PR's comments and timeline, posts the comments a reader chose to, changes a PR's state, and maps every process failure to a refusal the app can show
// beside its data or a kept draft.
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CommentRequest } from "../comments/comment-schema.ts";
import type { ReviewThread } from "../comments/thread-schema.ts";
import type { PrComments } from "../comments/timeline-schema.ts";
import type { PrDetail, PrSummary, StateChange } from "../contract.ts";
import { statusCheckRollupSchema } from "./checks.ts";
import { commentApiArgs, conversationCommentApiArgs, replyApiArgs } from "./comment-args.ts";
import { ghPostRefusalFor, ghRefusalFor, ghStateRefusalFor } from "./gh-refusal.ts";
import { ghLabelSchema } from "./label.ts";
import { parseHostCommandFailure, runHostCommand } from "./host-command.ts";
import { INBOX_QUERY, inboxVariables, parseInboxSearch, parseStackContext, stackContextQuery, type FoundPr, type GitHubPr } from "./inbox-search.ts";
import type { PrCommits } from "./pr-commits.ts";
import {
  allPages,
  CHANGED_PATHS_QUERY,
  graphqlArgs,
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
import { stateChangeArgs } from "./state-args.ts";

const LIST_LIMIT = 200;
const SUMMARY_FIELDS = ["number", "title", "author", "updatedAt", "headRefOid"];
const DETAIL_FIELDS = [...SUMMARY_FIELDS, "createdAt", "body", "url", "headRefName", "baseRefName", "state", "isDraft", "commits", "additions", "deletions", "statusCheckRollup", "reviewRequests", "latestReviews", "labels"];

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
});

const toDetail = (pr: z.infer<typeof ghDetailSchema>): PrDetail => ({
  ...toSummary(pr),
  createdAt: pr.createdAt,
  body: pr.body,
  url: pr.url,
  headRefName: pr.headRefName,
  baseRefName: pr.baseRefName,
  // A closed PR can still be marked draft; it reads as closed, as on GitHub.
  state: pr.state === "OPEN" && pr.isDraft ? "DRAFT" : pr.state,
  commits: pr.commits.map((commit) => commit.oid),
  additions: pr.additions,
  deletions: pr.deletions,
  checks: pr.statusCheckRollup,
  reviewers: toReviewers(pr.reviewRequests, pr.latestReviews),
  labels: pr.labels,
});

/** `gh pr view --json` output for DETAIL_FIELDS, as the canonical PR. */
export const parsePrDetail = (json: unknown): PrDetail => toDetail(ghDetailSchema.parse(json));

export async function listOpenPrs(repo: Repo): Promise<PrSummary[]> {
  const json = await runGh(["pr", "list", "-R", repo, "--state", "open", "--limit", String(LIST_LIMIT), "--json", SUMMARY_FIELDS.join(",")]);
  return z.array(ghSummarySchema).parse(JSON.parse(json)).map(toSummary);
}

/**
 * The PRs the sidebar's searches find in `repos` at `now` (epoch ms), and the open and recently
 * merged PRs of the repos they are in, which hold their stack-mates. Two gh calls at most.
 */
export async function readInbox(repos: Repo[], now: number): Promise<{ found: FoundPr[]; stackMates: GitHubPr[] }> {
  // No repo qualifier would search all of GitHub.
  if (repos.length === 0) return { found: [], stackMates: [] };
  const found = parseInboxSearch(await graphql(INBOX_QUERY, inboxVariables(repos, now)), now);
  const foundRepos = [...new Set(found.map(({ pr }) => pr.repo))];
  if (foundRepos.length === 0) return { found, stackMates: [] };
  return { found, stackMates: parseStackContext(await graphql(stackContextQuery(foundRepos), {})) };
}

export async function viewPr(repo: Repo, number: number): Promise<PrDetail> {
  const json = await runGh(["pr", "view", String(number), "-R", repo, "--json", DETAIL_FIELDS.join(",")]);
  return parsePrDetail(JSON.parse(json));
}

/** A PR's diff between the two commits it was read at. */
export type PrDiffSnapshot = PrCommits & { diff: string };

// `gh pr diff` takes no commit and always serves the current head against the current base,
// so read both before and after the diff and accept only a pair that agrees: a push to
// either branch in between changed the diff.
export async function snapshotPrDiff(repo: Repo, number: number): Promise<PrDiffSnapshot> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await commitsOf(repo, number);
    const diff = await runGh(["pr", "diff", String(number), "-R", repo, "--color", "never"]);
    const after = await commitsOf(repo, number);
    if (after.headSha === before.headSha && after.baseSha === before.baseSha) return { ...before, diff };
  }
  throw new Refusal({ code: "conflict", message: "The PR is being pushed to right now. Try again in a moment." });
}

// The contents API serves a file of up to 1 MB as base64 JSON; a larger one comes with no content.
const ghFileSchema = z.object({ encoding: z.string(), content: z.string() });

/** The text of the file at `path` in commit `sha`. Refuses a file over GitHub's 1 MB limit. */
export async function readFileAt(repo: Repo, sha: string, path: string): Promise<string> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const json = await runGh(["api", `repos/${repo}/contents/${encodedPath}?ref=${sha}`]);
  const file = ghFileSchema.parse(JSON.parse(json));
  if (file.encoding !== "base64") throw new Refusal({ code: "invalid", message: "The file is too large for GitHub to serve whole." });
  return Buffer.from(file.content, "base64").toString("utf8");
}

/** Every review thread on the PR, every item of its timeline and the paths it changes, all pages of each. */
export async function readPrComments(repo: Repo, number: number): Promise<PrComments> {
  const [threads, nodes, changedPaths] = await Promise.all([reviewThreadsOf(repo, number), timelineOf(repo, number), changedPathsOf(repo, number)]);
  return { threads, timeline: toTimeline(nodes, await reviewCommentsOf(nodes), threads), changedPaths };
}

async function changedPathsOf(repo: Repo, number: number): Promise<string[]> {
  const pr = prVariables(repo, number);
  const files = await allPages(null, async (cursor) => parseChangedPathsPage(await graphql(CHANGED_PATHS_QUERY, { ...pr, cursor })));
  return files.map((file) => file.path);
}

async function reviewThreadsOf(repo: Repo, number: number): Promise<ReviewThread[]> {
  const pr = prVariables(repo, number);
  const threads = await allPages(null, async (cursor) => parseThreadsPage(await graphql(THREADS_QUERY, { ...pr, cursor })));
  return Promise.all(
    threads.map(async (thread) => {
      const comments = await allPages(thread.comments, async (cursor) => parseThreadCommentsPage(await graphql(THREAD_COMMENTS_QUERY, { id: thread.id, cursor })));
      return toThread(thread, comments);
    }),
  );
}

async function timelineOf(repo: Repo, number: number): Promise<GhTimelineNode[]> {
  const pr = prVariables(repo, number);
  return allPages(null, async (cursor) => parseTimelinePage(await graphql(TIMELINE_QUERY, { ...pr, cursor })));
}

// Each review's comment ids, all pages, by the review's node id.
async function reviewCommentsOf(nodes: GhTimelineNode[]): Promise<Map<string, number[]>> {
  const reviews = await Promise.all(
    nodes.filter(isReview).map(async (review): Promise<[string, number[]]> => {
      const comments = await allPages(review.comments, async (cursor) => parseReviewCommentsPage(await graphql(REVIEW_COMMENTS_QUERY, { id: review.id, cursor })));
      return [review.id, comments.map((comment) => comment.databaseId)];
    }),
  );
  return new Map(reviews);
}

const graphql = async (query: string, variables: Record<string, string | number | null>): Promise<unknown> => JSON.parse(await runGh(graphqlArgs(query, variables)));

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

// why its own mapping: a POST that timed out may have reached GitHub (ghPostRefusalFor).
async function runGhPost(args: string[]): Promise<string> {
  try {
    return await runHostCommand("gh", args);
  } catch (error) {
    throw ghPostRefusalFor(parseHostCommandFailure(error));
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

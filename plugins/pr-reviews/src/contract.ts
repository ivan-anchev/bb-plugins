import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { codeQuoteSchema, commentBodySchema, commentRequestSchema, GITHUB_BODY_LIMIT } from "./comments/comment-schema.ts";
import { reviewEventSchema } from "./comments/review-schema.ts";
import { reviewThreadSchema } from "./comments/thread-schema.ts";
import { prCommentsSchema } from "./comments/timeline-schema.ts";
import { diffFileSchema } from "./diff/diff-schema.ts";
import { guideSchema } from "./guide/guide-schema.ts";
import { labelSchema } from "./github/label.ts";
import { repoKey, repoSchema, type Repo } from "./github/repo.ts";

const prNumberSchema = z.number().int().positive();

/** One head commit of one PR: the key of a pinned diff, a review run and a guide. */
export const prHeadKeySchema = z.object({ repo: repoSchema, number: prNumberSchema, headSha: z.string() });
export type PrHeadKey = z.infer<typeof prHeadKeySchema>;

const prSummarySchema = z.object({
  number: prNumberSchema,
  title: z.string(),
  author: z.string(),
  updatedAt: z.string(),
  headSha: z.string(),
});
export type PrSummary = z.infer<typeof prSummarySchema>;

const countSchema = z.number().int().nonnegative();

const checkOutcomeSchema = z.enum(["failing", "pending", "passing"]);
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;

const checkSchema = z.object({ name: z.string(), outcome: checkOutcomeSchema, url: z.string().nullable() });
export type Check = z.infer<typeof checkSchema>;

/** A PR's CI checks counted by outcome; all zero when the PR has none. */
export type ChecksSummary = Record<CheckOutcome, number>;

export function summarizeChecks(checks: Check[]): ChecksSummary {
  const summary: ChecksSummary = { failing: 0, pending: 0, passing: 0 };
  for (const check of checks) summary[check.outcome]++;
  return summary;
}

/** The one outcome that sums up a PR's checks, and how many have it: failing, else pending, else passing. */
export function leadingOutcome(summary: ChecksSummary): { outcome: CheckOutcome; count: number } {
  const outcome = summary.failing > 0 ? "failing" : summary.pending > 0 ? "pending" : "passing";
  return { outcome, count: summary[outcome] };
}

const reviewerStatusSchema = z.enum(["approved", "changes-requested", "commented", "awaiting"]);
export type ReviewerStatus = z.infer<typeof reviewerStatusSchema>;

const reviewerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), login: z.string(), status: reviewerStatusSchema }),
  z.object({ kind: z.literal("team"), name: z.string() }),
]);
export type Reviewer = z.infer<typeof reviewerSchema>;

const prStateSchema = z.enum(["OPEN", "DRAFT", "CLOSED", "MERGED"]);
export type PrState = z.infer<typeof prStateSchema>;

const stateChangeSchema = z.enum(["ready", "draft", "close", "reopen"]);
export type StateChange = z.infer<typeof stateChangeSchema>;

const mergeMethodSchema = z.enum(["merge", "squash", "rebase"]);
export type MergeMethod = z.infer<typeof mergeMethodSchema>;
export const MERGE_METHODS = mergeMethodSchema.options;

const prDetailSchema = prSummarySchema.extend({
  createdAt: z.string(),
  body: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  state: prStateSchema,
  commits: z.array(z.string()),
  additions: countSchema,
  deletions: countSchema,
  checks: z.array(checkSchema),
  reviewers: z.array(reviewerSchema),
  labels: z.array(labelSchema),
  mergeMethods: z.array(mergeMethodSchema),
  conflicting: z.boolean(),
});
export type PrDetail = z.infer<typeof prDetailSchema>;

/** A commit as people read it: its first seven characters. */
export const shortSha = (sha: string) => sha.slice(0, 7);

/** The PR's commits after the guide's head, or null when a force push removed that head from the PR. */
export function commitsSince(pr: PrDetail, guideHeadSha: string): number | null {
  const at = pr.commits.indexOf(guideHeadSha);
  return at === -1 ? null : pr.commits.length - at - 1;
}

const reviewStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("running"), threadId: z.string(), runHeadSha: z.string(), startedAt: z.number() }),
  z.object({ kind: z.literal("ready"), threadId: z.string(), guideHeadSha: z.string() }),
  z.object({ kind: z.literal("stale"), threadId: z.string(), guideHeadSha: z.string() }),
  z.object({ kind: z.literal("no-guide"), threadId: z.string(), idleSince: z.number() }),
]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

/** The head of the guide a review state shows, or null when it shows none. */
export function guideHeadShaOf(review: ReviewState): string | null {
  switch (review.kind) {
    case "ready":
    case "stale":
      return review.guideHeadSha;
    case "none":
    case "running":
    case "no-guide":
      return null;
    default:
      review satisfies never;
      return null;
  }
}

/** The PR's review thread: every state but "none" has one. */
export const reviewThreadOf = (review: ReviewState): string | null => (review.kind === "none" ? null : review.threadId);

const guideRecordSchema = z.object({
  key: prHeadKeySchema,
  threadId: z.string(),
  model: z.string().nullable(),
  submittedAt: z.number(),
  guide: guideSchema,
});
export type GuideRecord = z.infer<typeof guideRecordSchema>;

/** A bb project whose remote is on GitHub. */
export type GitHubProject = { id: string; name: string; repo: Repo };

const unreadableProjectSchema = z.object({ id: z.string(), name: z.string(), message: z.string() });
export type UnreadableProject = z.infer<typeof unreadableProjectSchema>;

const prRowSchema = prSummarySchema.extend({ review: reviewStateSchema });
export type PrRow = z.infer<typeof prRowSchema>;

const prRefSchema = z.object({ projectId: z.string(), number: prNumberSchema });

/** The sidebar's sections, in the order it shows them. */
export const SECTION_KEYS = ["authored", "review", "merged"] as const;
const sectionKeySchema = z.enum(SECTION_KEYS);
export type SectionKey = z.infer<typeof sectionKeySchema>;

const inboxPrSchema = z.object({
  projectId: z.string(),
  repo: repoSchema,
  number: prNumberSchema,
  title: z.string(),
  author: z.string(),
  state: prStateSchema,
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
  baseRefName: z.string(),
  headRefName: z.string(),
  ciFailing: z.boolean(),
  changesRequested: z.boolean(),
  section: sectionKeySchema.nullable(),
});
export type InboxPr = z.infer<typeof inboxPrSchema>;

const stackPositionSchema = z.object({ index: z.number().int().positive(), size: z.number().int().positive() });
export type StackPosition = z.infer<typeof stackPositionSchema>;

const sectionItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pr"), pr: inboxPrSchema, stack: stackPositionSchema.nullable() }),
  z.object({ kind: z.literal("stack"), members: z.array(inboxPrSchema) }),
]);
export type SectionItem = z.infer<typeof sectionItemSchema>;

const sectionSchema = z.object({ key: sectionKeySchema, count: countSchema, items: z.array(sectionItemSchema) });
export type Section = z.infer<typeof sectionSchema>;

const inboxSchema = z.object({ sections: z.array(sectionSchema), unreadable: z.array(unreadableProjectSchema) });

/** Every PR a section shows, stack-mates listed elsewhere included. */
export const prsOf = (section: Section): InboxPr[] => section.items.flatMap((item) => (item.kind === "pr" ? [item.pr] : item.members));

const visitSchema = z.object({ projectId: z.string(), repo: repoSchema, number: prNumberSchema, openedAt: z.number() });
export type Visit = z.infer<typeof visitSchema>;

const prChangesSchema = z.object({ headSha: z.string(), files: z.array(diffFileSchema) });
export type PrChanges = z.infer<typeof prChangesSchema>;

const fileAtCommitSchema = z.object({ projectId: z.string(), sha: z.string(), path: z.string() });
export type FileAtCommit = z.infer<typeof fileAtCommitSchema>;

const empty = z.object({});
const postedSchema = z.object({ url: z.string() });
export const VISITS_TAG = "visits";
export const INBOX_TAG = "inbox";
export const repoTag = (repo: Repo) => `repo:${repoKey(repo)}`;
export const guideTag = ({ repo, number, headSha }: PrHeadKey) => `guide:${repo}#${number}@${headSha}`;
export const commentsTag = ({ projectId, number }: z.infer<typeof prRefSchema>) => `comments:${projectId}#${number}`;

export const prReviewsContract = defineRpcContract({
  /**
   * The sidebar: the reader's PRs across every bb project with a GitHub remote, in sections. Tagged
   * by every repo it lists, so the thread events that refresh a repo's reads refresh it too, and by
   * its own tag, which a state change refreshes whether or not the sidebar lists the PR's repo.
   */
  inbox: {
    input: empty,
    output: inboxSchema,
    tags: (_input, output) => [INBOX_TAG, ...new Set(output.sections.flatMap(prsOf).map((pr) => repoTag(pr.repo)))],
  },
  /** When the reader last opened each PR, for the sidebar's new-activity dot and the rail badge's project. */
  visits: { input: empty, output: z.object({ visits: z.array(visitSchema) }), tags: () => [VISITS_TAG] },
  /** The PR page opened: records the visit. */
  recordVisit: { input: prRefSchema, output: empty },
  pullRequests: {
    input: z.object({ projectId: z.string() }),
    output: z.object({ repo: repoSchema, rows: z.array(prRowSchema) }),
    tags: (_input, output) => [repoTag(output.repo)],
  },
  pullRequest: {
    input: prRefSchema,
    output: z.object({ repo: repoSchema, pr: prDetailSchema, review: reviewStateSchema }),
    tags: (_input, output) => [repoTag(output.repo)],
  },
  /** A guide and the pinned diff it walks through. Its own tag: thread events refresh the small reads, not this large one. */
  guide: {
    input: prRefSchema.extend({ headSha: z.string() }),
    output: z.object({ record: guideRecordSchema, files: z.array(diffFileSchema) }),
    tags: (_input, output) => [guideTag(output.record.key)],
  },
  /**
   * The PR's whole diff (base...head) as GitHub serves it now, and the head it reflects. It needs
   * no review run. Untagged: it runs `gh pr diff`, so it re-reads only on Refresh, never on a
   * thread event.
   */
  changes: { input: prRefSchema, output: prChangesSchema },
  /** One file's text at one commit of the project's repo, for the Changes tab's diff to expand its unchanged lines. Untagged, like `changes`. */
  fileContent: { input: fileAtCommitSchema, output: z.object({ content: z.string() }) },
  startReview: { input: prRefSchema, output: z.object({ threadId: z.string() }) },
  cancelReview: { input: prRefSchema, output: empty },
  nudgeReview: { input: prRefSchema, output: empty },
  /** Asks the stale guide's thread to update it for the PR's current head, or starts a new review when that thread is gone. */
  updateGuide: { input: prRefSchema, output: z.object({ threadId: z.string() }) },
  /** Sends the reader's question about one finding of a guide, named by its index, to the guide's review thread. */
  askAboutFinding: {
    input: prRefSchema.extend({ headSha: z.string(), findingIndex: z.number().int().nonnegative(), question: z.string().trim().min(1) }),
    output: empty,
  },
  /** Sends the reader's question about lines they selected in a diff, quoted, to the PR's review thread. */
  askAboutLines: {
    input: prRefSchema.extend({ quote: codeQuoteSchema, question: z.string().trim().min(1) }),
    output: empty,
  },
  /** Sends the reader's question about one of the PR's GitHub review threads, as the page shows it, to the PR's review thread. */
  askAboutGitHubThread: {
    input: prRefSchema.extend({ thread: reviewThreadSchema, question: z.string().trim().min(1) }),
    output: empty,
  },
  /**
   * Every comment GitHub has on the PR: its review threads and its timeline. Tagged per PR:
   * each post below re-reads it, so the comment shows in place.
   */
  comments: { input: prRefSchema, output: prCommentsSchema, tags: (input) => [commentsTag(input)] },
  /** Posts one review comment to the project's PR exactly as requested, on the reader's click. Resolves to the comment's page on GitHub. */
  postComment: { input: prRefSchema.extend({ request: commentRequestSchema }), output: postedSchema },
  /** Posts a reply in the review thread that `commentId`, the thread's first comment, opens. */
  replyToThread: { input: prRefSchema.extend({ commentId: z.number().int(), body: commentBodySchema }), output: postedSchema },
  /** Posts a comment on the PR's conversation, on no file: what a quote reply to a conversation comment posts. */
  postConversationComment: { input: prRefSchema.extend({ body: commentBodySchema }), output: postedSchema },
  /**
   * Changes the PR's state on GitHub, on the reader's choice. Re-reads the PR's repo and the
   * sidebar, so the page header and the sidebar row show the new state, and the sidebar again
   * once GitHub's search lists it.
   */
  changePrState: { input: prRefSchema.extend({ change: stateChangeSchema }), output: empty },
  /**
   * Merges the PR on GitHub by `method`, on the reader's choice, only while its head is still
   * `headSha`, the head the page shows. Re-reads as a state change does.
   */
  mergePr: { input: prRefSchema.extend({ method: mergeMethodSchema, headSha: z.string() }), output: empty },
  /**
   * Adds a review comment to the reader's pending review `reviewId` (the comments read's), or to
   * one GitHub starts for it when null. Nothing is published until the review is submitted.
   */
  addToReview: { input: prRefSchema.extend({ request: commentRequestSchema, reviewId: z.string().nullable() }), output: empty },
  /** Adds a reply in the review thread `threadId` (its node id) to the pending review `reviewId`. */
  addReplyToReview: { input: prRefSchema.extend({ threadId: z.string(), reviewId: z.string(), body: commentBodySchema }), output: empty },
  /**
   * Submits the reader's pending review `reviewId`, publishing its comments, with an optional
   * summary (`body` "" for none); with none pending (null), submits a review with no comments,
   * which GitHub takes as a comment only with a body.
   */
  submitReview: { input: prRefSchema.extend({ reviewId: z.string().nullable(), event: reviewEventSchema, body: z.string().max(GITHUB_BODY_LIMIT) }), output: empty },
  /** Deletes the pending review and every comment in it. */
  discardReview: { input: prRefSchema.extend({ reviewId: z.string() }), output: empty },
});

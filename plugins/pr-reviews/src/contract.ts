// The app <-> server contract and the canonical types that cross it.
// Shared by server.ts and app.tsx: pure zod, no SDK runtime beyond defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { codeQuoteSchema, commentBodySchema, commentRequestSchema } from "./comments/comment-schema.ts";
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
  /** ISO 8601; the row shows it relative to now. */
  updatedAt: z.string(),
  headSha: z.string(),
});
export type PrSummary = z.infer<typeof prSummarySchema>;

const countSchema = z.number().int().nonnegative();

/** What a CI check says, folded from GitHub's statuses, conclusions and states by `github/checks.ts`. */
const checkOutcomeSchema = z.enum(["failing", "pending", "passing"]);
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;

/** One CI check: its name, outcome, and details page, null when GitHub gives it none. */
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

/** Where a reviewer stands: their latest review, or awaiting one they were asked for. */
const reviewerStatusSchema = z.enum(["approved", "changes-requested", "commented", "awaiting"]);
export type ReviewerStatus = z.infer<typeof reviewerStatusSchema>;

// A team is only ever requested: its members review as users.
const reviewerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), login: z.string(), status: reviewerStatusSchema }),
  z.object({ kind: z.literal("team"), name: z.string() }),
]);
export type Reviewer = z.infer<typeof reviewerSchema>;

/** GitHub's state of a PR, where an open draft is DRAFT. */
const prStateSchema = z.enum(["OPEN", "DRAFT", "CLOSED", "MERGED"]);
export type PrState = z.infer<typeof prStateSchema>;

const prDetailSchema = prSummarySchema.extend({
  body: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  state: prStateSchema,
  /** Commit oids, oldest first. */
  commits: z.array(z.string()),
  /** Lines added and deleted across the whole PR. */
  additions: countSchema,
  deletions: countSchema,
  /** In GitHub's order. */
  checks: z.array(checkSchema),
  /** Requested reviewers first, then the rest who reviewed. */
  reviewers: z.array(reviewerSchema),
  labels: z.array(labelSchema),
});
export type PrDetail = z.infer<typeof prDetailSchema>;

/** A commit as people read it: its first seven characters. */
export const shortSha = (sha: string) => sha.slice(0, 7);

/** The PR's commits after the guide's head, or null when a force push removed that head from the PR. */
export function commitsSince(pr: PrDetail, guideHeadSha: string): number | null {
  const at = pr.commits.indexOf(guideHeadSha);
  return at === -1 ? null : pr.commits.length - at - 1;
}

// A sum type on `kind`: each variant carries exactly what its screen needs.
const reviewStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  /** A review thread is writing the guide for `runHeadSha`; `startedAt` is epoch ms. */
  z.object({ kind: z.literal("running"), threadId: z.string(), runHeadSha: z.string(), startedAt: z.number() }),
  /** A guide exists for the PR's current head, `guideHeadSha`. */
  z.object({ kind: z.literal("ready"), threadId: z.string(), guideHeadSha: z.string() }),
  /** The newest guide is for `guideHeadSha`, an older head. */
  z.object({ kind: z.literal("stale"), threadId: z.string(), guideHeadSha: z.string() }),
  /** The review thread for the current head settled without a guide; `idleSince` is epoch ms. */
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

/** A guide as stored: who wrote it (`model` is null when bb did not report one), for which head, and when (epoch ms). */
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

// A project whose remote could not be read. The sidebar leaves its PRs out and shows why.
const unreadableProjectSchema = z.object({ id: z.string(), name: z.string(), message: z.string() });
export type UnreadableProject = z.infer<typeof unreadableProjectSchema>;

const prRowSchema = prSummarySchema.extend({ review: reviewStateSchema });
export type PrRow = z.infer<typeof prRowSchema>;

const prRefSchema = z.object({ projectId: z.string(), number: prNumberSchema });

/** The sidebar's sections, in the order it shows them. */
export const SECTION_KEYS = ["authored", "review", "merged"] as const;
const sectionKeySchema = z.enum(SECTION_KEYS);
export type SectionKey = z.infer<typeof sectionKeySchema>;

/**
 * A PR as the sidebar lists it, with the bb project it opens in. `section` is where it is listed,
 * or null for a stack-mate listed in no section.
 */
const inboxPrSchema = z.object({
  projectId: z.string(),
  repo: repoSchema,
  number: prNumberSchema,
  title: z.string(),
  author: z.string(),
  state: prStateSchema,
  /** ISO 8601, like `mergedAt`, which is null until the PR merges. */
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
  baseRefName: z.string(),
  headRefName: z.string(),
  ciFailing: z.boolean(),
  changesRequested: z.boolean(),
  section: sectionKeySchema.nullable(),
});
export type InboxPr = z.infer<typeof inboxPrSchema>;

/** Where a PR sits in its stack: `index` counts from 1 at the bottom, the PR the others build on. */
const stackPositionSchema = z.object({ index: z.number().int().positive(), size: z.number().int().positive() });
export type StackPosition = z.infer<typeof stackPositionSchema>;

/**
 * One entry of a section: a PR, with its place in a stack when it is the only one of its stack
 * in the section, or a stack with two or more of its PRs in the section, bottom first, holding
 * its PRs listed elsewhere or nowhere too.
 */
const sectionItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pr"), pr: inboxPrSchema, stack: stackPositionSchema.nullable() }),
  z.object({ kind: z.literal("stack"), members: z.array(inboxPrSchema) }),
]);
export type SectionItem = z.infer<typeof sectionItemSchema>;

/** A section's entries, most recent first, and how many PRs it lists. */
const sectionSchema = z.object({ key: sectionKeySchema, count: countSchema, items: z.array(sectionItemSchema) });
export type Section = z.infer<typeof sectionSchema>;

const inboxSchema = z.object({ sections: z.array(sectionSchema), unreadable: z.array(unreadableProjectSchema) });

/** Every PR a section shows, stack-mates listed elsewhere included. */
const prsOf = (section: Section): InboxPr[] => section.items.flatMap((item) => (item.kind === "pr" ? [item.pr] : item.members));

/** When the reader last opened a PR's page, epoch ms, and the project it opened in. */
const visitSchema = z.object({ projectId: z.string(), repo: repoSchema, number: prNumberSchema, openedAt: z.number() });
export type Visit = z.infer<typeof visitSchema>;

/** The PR's whole diff and the head it reflects: the `changes` read. */
const prChangesSchema = z.object({ headSha: z.string(), files: z.array(diffFileSchema) });
export type PrChanges = z.infer<typeof prChangesSchema>;

/** A file of a project's repo at one commit: the `fileContent` read's input. */
const fileAtCommitSchema = z.object({ projectId: z.string(), sha: z.string(), path: z.string() });
export type FileAtCommit = z.infer<typeof fileAtCommitSchema>;

const empty = z.object({});
/** A comment the plugin posted: its page on GitHub. */
const postedSchema = z.object({ url: z.string() });
export const VISITS_TAG = "visits";
export const repoTag = (repo: Repo) => `repo:${repoKey(repo)}`;
export const guideTag = ({ repo, number, headSha }: PrHeadKey) => `guide:${repo}#${number}@${headSha}`;
export const commentsTag = ({ projectId, number }: z.infer<typeof prRefSchema>) => `comments:${projectId}#${number}`;

export const prReviewsContract = defineRpcContract({
  /**
   * The sidebar: the reader's PRs across every bb project with a GitHub remote, in sections. Tagged
   * by every repo it lists, so the thread events that refresh a repo's reads refresh it too.
   */
  inbox: {
    input: empty,
    output: inboxSchema,
    tags: (_input, output) => [...new Set(output.sections.flatMap(prsOf).map((pr) => repoTag(pr.repo)))],
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
});

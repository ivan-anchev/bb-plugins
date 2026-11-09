// The app <-> server contract and the canonical types that cross it.
// Shared by server.ts and app.tsx: pure zod, no SDK runtime beyond defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { codeQuoteSchema, commentRequestSchema } from "./comments/comment-schema.ts";
import { diffFileSchema } from "./diff/diff-schema.ts";
import { guideSchema } from "./guide/guide-schema.ts";
import { repoSchema, type Repo } from "./github/repo.ts";

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

/** A GitHub label; `color` is a CSS hex color, `#rrggbb`. */
const labelSchema = z.object({ name: z.string(), color: z.string() });
export type Label = z.infer<typeof labelSchema>;

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

const githubProjectSchema = z.object({ id: z.string(), name: z.string(), repo: repoSchema });
export type GitHubProject = z.infer<typeof githubProjectSchema>;

// A project whose remote could not be read. The picker leaves it out and shows why.
const unreadableProjectSchema = z.object({ id: z.string(), name: z.string(), message: z.string() });
export type UnreadableProject = z.infer<typeof unreadableProjectSchema>;

const prRowSchema = prSummarySchema.extend({ review: reviewStateSchema });
export type PrRow = z.infer<typeof prRowSchema>;

const prRefSchema = z.object({ projectId: z.string(), number: prNumberSchema });

/** The PR's whole diff and the head it reflects: the `changes` read. */
const prChangesSchema = z.object({ headSha: z.string(), files: z.array(diffFileSchema) });
export type PrChanges = z.infer<typeof prChangesSchema>;

/** A file of a project's repo at one commit: the `fileContent` read's input. */
const fileAtCommitSchema = z.object({ projectId: z.string(), sha: z.string(), path: z.string() });
export type FileAtCommit = z.infer<typeof fileAtCommitSchema>;

const empty = z.object({});
export const PROJECTS_TAG = "projects";
export const repoTag = (repo: Repo) => `repo:${repo}`;
export const guideTag = ({ repo, number, headSha }: PrHeadKey) => `guide:${repo}#${number}@${headSha}`;

export const prReviewsContract = defineRpcContract({
  projects: {
    input: empty,
    output: z.object({
      projects: z.array(githubProjectSchema),
      unreadable: z.array(unreadableProjectSchema),
      selectedProjectId: z.string().nullable(),
    }),
    tags: () => [PROJECTS_TAG],
  },
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
  selectProject: { input: z.object({ projectId: z.string() }), output: empty },
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
  /**
   * Posts one review comment to the project's PR exactly as requested, on the reader's click.
   * Resolves to the comment's page on GitHub. Untagged: nothing the plugin reads shows comments.
   */
  postComment: { input: prRefSchema.extend({ request: commentRequestSchema }), output: z.object({ url: z.string() }) },
});

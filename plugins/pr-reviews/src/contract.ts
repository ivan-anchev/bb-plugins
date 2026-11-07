// The app <-> server contract and the canonical types that cross it.
// Shared by server.ts and app.tsx: pure zod, no SDK runtime beyond defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
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

const prDetailSchema = prSummarySchema.extend({
  body: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  /** Commit oids, oldest first. */
  commits: z.array(z.string()),
});
export type PrDetail = z.infer<typeof prDetailSchema>;

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
});

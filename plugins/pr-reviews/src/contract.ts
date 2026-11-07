// The app <-> server contract and the canonical types that cross it.
// Shared by server.ts and app.tsx: pure zod, no SDK runtime beyond defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { repoSchema, type Repo } from "./github/repo.ts";

const prNumberSchema = z.number().int().positive();

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

// A sum type on `kind`: each variant carries exactly what its screen needs. Later states
// (ready, stale) join as variants.
const reviewStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  /** A review thread is writing the guide for `runHeadSha`; `startedAt` is epoch ms. */
  z.object({ kind: z.literal("running"), threadId: z.string(), runHeadSha: z.string(), startedAt: z.number() }),
  /** The review thread for the current head settled without a guide; `idleSince` is epoch ms. */
  z.object({ kind: z.literal("no-guide"), threadId: z.string(), idleSince: z.number() }),
]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

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
  selectProject: { input: z.object({ projectId: z.string() }), output: empty },
  startReview: { input: prRefSchema, output: z.object({ threadId: z.string() }) },
  cancelReview: { input: prRefSchema, output: empty },
  nudgeReview: { input: prRefSchema, output: empty },
});

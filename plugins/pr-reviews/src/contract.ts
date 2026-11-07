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

// A sum type on `kind`: later states (running, ready, stale, no-guide) join as variants that
// carry exactly what their screen needs.
const reviewStateSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("none") })]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

const githubProjectSchema = z.object({ id: z.string(), name: z.string(), repo: repoSchema });
export type GitHubProject = z.infer<typeof githubProjectSchema>;

// A project whose remote could not be read. The picker leaves it out and shows why.
const unreadableProjectSchema = z.object({ id: z.string(), name: z.string(), message: z.string() });
export type UnreadableProject = z.infer<typeof unreadableProjectSchema>;

const prRowSchema = prSummarySchema.extend({ review: reviewStateSchema });
export type PrRow = z.infer<typeof prRowSchema>;

const empty = z.object({});
export const PROJECTS_TAG = "projects";
const repoTag = (repo: Repo) => `repo:${repo}`;

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
    input: z.object({ projectId: z.string(), number: prNumberSchema }),
    output: z.object({ repo: repoSchema, pr: prDetailSchema, review: reviewStateSchema }),
    tags: (_input, output) => [repoTag(output.repo)],
  },
  selectProject: { input: z.object({ projectId: z.string() }), output: empty },
});

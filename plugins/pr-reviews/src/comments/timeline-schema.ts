import { z } from "zod";
import { labelSchema } from "../github/label.ts";
import { viewerReviewSchema } from "./review-schema.ts";
import { githubCommentSchema, reviewThreadSchema } from "./thread-schema.ts";

const eventOf = <Kind extends string, Shape extends z.ZodRawShape>(kind: Kind, shape: Shape) =>
  z.object({ kind: z.literal(kind), id: z.string(), actor: z.string(), createdAt: z.string(), ...shape });

const reviewVerdictSchema = z.enum(["approved", "changes-requested", "commented", "dismissed"]);
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

const statusSchema = z.enum(["ready-for-review", "draft", "closed", "reopened", "branch-deleted", "branch-restored", "auto-merge-enabled", "auto-merge-disabled"]);
export type StatusChange = z.infer<typeof statusSchema>;

export const timelineItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("comment"), id: z.string(), comment: githubCommentSchema }),
  z.object({ kind: z.literal("review"), id: z.string(), verdict: reviewVerdictSchema, comment: githubCommentSchema, threadIds: z.array(z.string()) }),
  z.object({ kind: z.literal("commit"), id: z.string(), sha: z.string(), headline: z.string(), url: z.string(), createdAt: z.string() }),
  eventOf("labeled", { added: z.boolean(), label: labelSchema }),
  eventOf("renamed", { from: z.string(), to: z.string() }),
  eventOf("review-requested", { requested: z.boolean(), reviewer: z.string() }),
  eventOf("review-dismissed", { reviewer: z.string() }),
  eventOf("assigned", { assigned: z.boolean(), assignee: z.string() }),
  eventOf("milestoned", { added: z.boolean(), title: z.string() }),
  eventOf("merged", { base: z.string() }),
  eventOf("force-pushed", { before: z.string().nullable(), after: z.string().nullable() }),
  eventOf("base-changed", { from: z.string(), to: z.string() }),
  eventOf("referenced", { ref: z.string(), title: z.string(), url: z.string() }),
  eventOf("status", { status: statusSchema }),
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;

/** When the item happened, in ISO 8601. */
export function timeOf(item: TimelineItem): string {
  switch (item.kind) {
    case "comment":
    case "review":
      return item.comment.createdAt;
    case "commit":
    case "labeled":
    case "renamed":
    case "review-requested":
    case "review-dismissed":
    case "assigned":
    case "milestoned":
    case "merged":
    case "force-pushed":
    case "base-changed":
    case "referenced":
    case "status":
      return item.createdAt;
    default:
      return item satisfies never;
  }
}

/**
 * Every comment on a PR, in GitHub's order: its review threads, and its timeline, which holds the
 * conversation's comments and the reviews that opened the threads. `changedPaths`: the files the
 * PR's diff changes, named as a thread names its file, byte for byte; a thread on any other file
 * has left the diff. `viewer`: the reader's own review, whose pending comments are in `threads`.
 */
export const prCommentsSchema = z.object({
  threads: z.array(reviewThreadSchema),
  timeline: z.array(timelineItemSchema),
  changedPaths: z.array(z.string()),
  viewer: viewerReviewSchema,
});
export type PrComments = z.infer<typeof prCommentsSchema>;

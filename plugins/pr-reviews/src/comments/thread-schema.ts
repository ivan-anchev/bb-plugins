// The canonical shapes of the comments GitHub already has on a PR: review threads on its files and
// the conversation's comments. Parsed once from gh (github/pr-comments.ts); pure zod, shared by the
// server and the app.
import { z } from "zod";
import { lineRefSchema } from "./comment-schema.ts";

/**
 * One comment as the plugin shows it. `id` is GitHub's number for it in its own kind: a review
 * comment's is what a reply names. `author` is a login; a deleted account's is "ghost", as on GitHub.
 * `createdAt` is ISO 8601.
 */
export const githubCommentSchema = z.object({ id: z.number().int(), url: z.string(), author: z.string(), body: z.string(), createdAt: z.string() });
export type GitHubComment = z.infer<typeof githubCommentSchema>;

/** The lines a thread is on in the diff at `commit`: `end` is GitHub's line and side, `start` null for one line. */
const lineAnchorSchema = z.object({ commit: z.string(), start: lineRefSchema.nullable(), end: lineRefSchema });
export type LineAnchor = z.infer<typeof lineAnchorSchema>;

/**
 * A review thread on one file: on the whole file, or on lines. A thread on lines knows them at
 * each commit GitHub has them at, newest first: where they are at the PR's head unless the thread
 * is outdated, then where it was written. A diff at another commit shows it at its file.
 * `comments` are in GitHub's order, the thread's first comment first.
 */
export const reviewThreadSchema = z.object({
  id: z.string(),
  path: z.string(),
  resolved: z.boolean(),
  outdated: z.boolean(),
  subject: z.discriminatedUnion("kind", [z.object({ kind: z.literal("file") }), z.object({ kind: z.literal("lines"), anchors: z.array(lineAnchorSchema) })]),
  comments: z.array(githubCommentSchema).min(1),
});
export type ReviewThread = z.infer<typeof reviewThreadSchema>;

/** Every comment on a PR: its review threads, and its conversation (the comments on no file), each in GitHub's order. */
export const prCommentsSchema = z.object({ threads: z.array(reviewThreadSchema), conversation: z.array(githubCommentSchema) });
export type PrComments = z.infer<typeof prCommentsSchema>;

/** A comment's text as a quote that opens a reply, as GitHub's Quote reply writes it: each line behind `> `, then a blank line. */
export function quoteReplyText(body: string): string {
  const quoted = body
    .trimEnd()
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`));
  return `${quoted.join("\n")}\n\n`;
}

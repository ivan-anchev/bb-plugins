// The canonical shapes of the comments GitHub already has on a PR: one comment, and the review
// threads on its files. Parsed once from gh (github/pr-comments.ts); pure zod, shared by the
// server and the app.
import { z } from "zod";
import { numberedLineSchema } from "../diff/diff-schema.ts";
import { lineRefSchema } from "./comment-schema.ts";

/**
 * One comment as the plugin shows it. `id` is GitHub's number for it in its own kind: a review
 * comment's is what a reply names. `author.login` is a deleted account's "ghost", as on GitHub;
 * `author.bot`: an app wrote it. `createdAt` is ISO 8601. `pending`: a review comment in the
 * reader's pending review, which only they can see until they submit it.
 */
export const githubCommentSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  author: z.object({ login: z.string(), bot: z.boolean() }),
  body: z.string(),
  createdAt: z.string(),
  pending: z.boolean(),
});
export type GitHubComment = z.infer<typeof githubCommentSchema>;

/** The lines a thread is on in the diff at `commit`: `end` is GitHub's line and side, `start` null for one line. */
const lineAnchorSchema = z.object({ commit: z.string(), start: lineRefSchema.nullable(), end: lineRefSchema });
export type LineAnchor = z.infer<typeof lineAnchorSchema>;

/**
 * A review thread on one file: on the whole file, or on lines. A thread on lines knows them at
 * each commit GitHub has them at, newest first: where they are at the PR's head unless the thread
 * is outdated, then where it was written. A diff at another commit shows it at its file, with
 * `excerpt`: the lines it was written on, as GitHub kept them. `resolvedBy` is who resolved it,
 * null while it is open. `comments` are in GitHub's order, the thread's first comment first.
 */
export const reviewThreadSchema = z.object({
  id: z.string(),
  path: z.string(),
  resolvedBy: z.string().nullable(),
  outdated: z.boolean(),
  subject: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("file") }),
    z.object({ kind: z.literal("lines"), anchors: z.array(lineAnchorSchema), excerpt: z.array(numberedLineSchema) }),
  ]),
  comments: z.array(githubCommentSchema).min(1),
});
export type ReviewThread = z.infer<typeof reviewThreadSchema>;

/** A comment's text as a quote that opens a reply, as GitHub's Quote reply writes it: each line behind `> `, then a blank line. */
export function quoteReplyText(body: string): string {
  const quoted = body
    .trimEnd()
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`));
  return `${quoted.join("\n")}\n\n`;
}

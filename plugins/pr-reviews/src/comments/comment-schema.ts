import { z } from "zod";
import { diffSideSchema, type DiffSide } from "../diff/diff-schema.ts";

/** A line number on one side of a file's diff. As in a finding, "old" names only a removed line. */
export const lineRefSchema = z.object({ side: diffSideSchema, line: z.number().int().positive() });
export type LineRef = z.infer<typeof lineRefSchema>;

/**
 * Lines a reader selected in one file at one commit, in diff order, each with its diff prefix.
 * `path` is the diff's path, byte for byte: never trimmed (REVIEW.md).
 */
export const codeQuoteSchema = z.object({
  path: z.string(),
  commit: z.string(),
  start: lineRefSchema,
  end: lineRefSchema,
  lines: z.array(z.string()).min(1),
});
export type CodeQuote = z.infer<typeof codeQuoteSchema>;

/** The most characters GitHub takes in a comment's body. */
export const GITHUB_BODY_LIMIT = 65_536;

/** The text of any comment the plugin posts: a review comment, a reply, a conversation comment. */
export const commentBodySchema = z.string().min(1).max(GITHUB_BODY_LIMIT);

/**
 * A review comment exactly as GitHub is asked to post it, at the commit the reader viewed. A line
 * comment's `end` is GitHub's `line`/`side`; `start` is null for one line, which GitHub takes
 * without `start_line`. A file comment is on the whole file and quotes its lines in `body`. The
 * preview shows this, the RPC carries it, and the server sends it field for field.
 */
export const commentRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), commit: z.string(), path: z.string(), start: lineRefSchema.nullable(), end: lineRefSchema, body: commentBodySchema }),
  z.object({ kind: z.literal("file"), commit: z.string(), path: z.string(), body: commentBodySchema }),
]);
export type CommentRequest = z.infer<typeof commentRequestSchema>;

/** GitHub's name for a side of the diff. */
export const githubSideOf = (side: DiffSide): "LEFT" | "RIGHT" => (side === "old" ? "LEFT" : "RIGHT");

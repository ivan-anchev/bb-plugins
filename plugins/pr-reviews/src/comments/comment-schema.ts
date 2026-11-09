// The canonical shapes of lines someone points at in a file's diff: a guide's finding, a note the
// app draws under a line, the lines a reader selected. Pure zod, shared by the app and the server.
import { z } from "zod";
import { diffSideSchema } from "../diff/diff-schema.ts";

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

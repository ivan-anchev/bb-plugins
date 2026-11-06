// The canonical shape of a PR diff. Shared: the server builds it from `gh pr diff`, and the
// app will render it.
import { z } from "zod";

const hunkSchema = z.object({
  /** The numbers of the hunk's `@@ -oldStart,oldLines +newStart,newLines @@` header, as git writes them. */
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  /** Raw lines with their prefix: " " context, "+" added, "-" removed, "\" no-newline marker. */
  lines: z.array(z.string()),
});
export type Hunk = z.infer<typeof hunkSchema>;

const diffFileSchema = z.object({
  /** The new path; the old path for a deletion. */
  path: z.string(),
  /** The old path of a rename, otherwise null. */
  previousPath: z.string().nullable(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  binary: z.boolean(),
  /** Empty for a file with no text hunks (binary, rename-only, mode-only, empty new file). */
  hunks: z.array(hunkSchema),
});
export type DiffFile = z.infer<typeof diffFileSchema>;

// The name the review agent uses for one unit of a file's change. Derived from the hunk's
// numbers, never stored beside them, so the two cannot disagree.
const hunkIdSchema = z.string().brand<"HunkId">();
export type HunkId = z.infer<typeof hunkIdSchema>;

/** The one unit of a file with no text hunks. */
export const WHOLE_FILE = hunkIdSchema.parse("whole file");

/** The hunk's header in canonical form: both counts always written, `@@ -a,b +c,d @@`. */
export function hunkIdOf(hunk: Hunk): HunkId {
  return hunkIdSchema.parse(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
}

/** The units a guide must place for this file: each hunk, or the whole file when it has none. */
export function unitIdsOf(file: DiffFile): HunkId[] {
  return file.hunks.length === 0 ? [WHOLE_FILE] : file.hunks.map(hunkIdOf);
}

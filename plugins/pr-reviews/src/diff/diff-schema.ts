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

export const diffFileSchema = z.object({
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
export const hunkIdSchema = z.string().brand<"HunkId">();
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

/** How many lines a change adds and removes. */
export type LineCounts = { added: number; removed: number };

/** The lines these raw hunk lines add and remove; context and `\ No newline` markers count on neither side. */
export function lineCountsOf(lines: readonly string[]): LineCounts {
  return { added: lines.filter((line) => line[0] === "+").length, removed: lines.filter((line) => line[0] === "-").length };
}

/** The lines the whole file adds and removes. A file with no text hunks has none. */
export const fileLineCountsOf = (file: DiffFile): LineCounts => lineCountsOf(file.hunks.flatMap((hunk) => hunk.lines));

/** One line of a hunk with its line number on each side; null on the side it is not on. */
export type NumberedLine = { text: string; old: number | null; new: number | null };

/** The hunk's lines numbered from its header. The `\ No newline` marker is on neither side. */
export function numberedLines(hunk: Hunk): NumberedLine[] {
  let { old: oldNumber, new: newNumber } = firstLinesOf(hunk);
  return hunk.lines.map((text) => {
    switch (text[0]) {
      case " ":
        return { text, old: oldNumber++, new: newNumber++ };
      case "-":
        return { text, old: oldNumber++, new: null };
      case "+":
        return { text, old: null, new: newNumber++ };
      default:
        return { text, old: null, new: null };
    }
  });
}

/**
 * The number the hunk's first line on each side has, or would have. git writes the line before
 * an empty side as its start (`@@ -0,0 +1,2 @@`), so an empty side starts one line later.
 */
export function firstLinesOf(hunk: Hunk): { old: number; new: number } {
  return { old: firstLineOf(hunk.oldStart, hunk.oldLines), new: firstLineOf(hunk.newStart, hunk.newLines) };
}

const firstLineOf = (start: number, count: number) => (count === 0 ? start + 1 : start);

// why throw: a guide is validated against exactly these files, so a miss is a storage bug that
// should fail loudly, not a case to render around.

/** The file a guide names. */
export function fileOf(files: DiffFile[], path: string): DiffFile {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`The guide names ${path}, which is not in its diff`);
  return file;
}

/** The text hunk a guide names in `file`. */
export function hunkOf(file: DiffFile, id: HunkId): Hunk {
  const hunk = file.hunks.find((candidate) => hunkIdOf(candidate) === id);
  if (hunk === undefined) throw new Error(`The guide names ${id} in ${file.path}, which has no such hunk`);
  return hunk;
}

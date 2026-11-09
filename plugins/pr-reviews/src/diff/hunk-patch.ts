// A hunk or a whole file as patch text, which the app's diff draws. Shared: the app draws each
// hunk of a step on its own, and each file of the Changes tab whole.
import { hunkIdOf, type DiffFile, type Hunk } from "./diff-schema.ts";

/** A headerless single-hunk patch: its `@@` header and its lines. */
export function hunkToPatch(hunk: Hunk): string {
  return `${hunkIdOf(hunk)}\n${hunk.lines.join("\n")}\n`;
}

/** A headerless patch of every hunk of the file, in order; the app's diff writes the file names above it. */
export function filePatchOf(file: DiffFile): string {
  return file.hunks.map(hunkToPatch).join("");
}

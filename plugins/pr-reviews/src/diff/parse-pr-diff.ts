// Boundary: `gh pr diff` text to canonical DiffFiles. Server only, since it bundles jsdiff.
import { parsePatch, type StructuredPatch, type StructuredPatchHunk } from "diff";
import type { DiffFile, Hunk } from "./diff-schema.ts";

/** Throws when a hunk's line counts disagree with its header, as in a truncated diff. */
export function parsePrDiff(text: string): DiffFile[] {
  return parsePatch(text).map(toDiffFile);
}

function toDiffFile(patch: StructuredPatch): DiffFile {
  const oldPath = withoutPrefix(patch.oldFileName);
  const newPath = withoutPrefix(patch.newFileName);
  return {
    path: patch.isDelete === true ? oldPath : newPath,
    previousPath: patch.isRename === true ? oldPath : null,
    status: statusOf(patch),
    binary: patch.isBinary === true,
    hunks: patch.hunks.map(toHunk),
  };
}

function statusOf(patch: StructuredPatch): DiffFile["status"] {
  if (patch.isCreate === true) return "added";
  if (patch.isDelete === true) return "deleted";
  if (patch.isRename === true) return "renamed";
  return "modified";
}

// jsdiff adds one to the start of a side whose count is zero (`@@ -0,0 +1,2 @@` reads as
// oldStart 1). Undo it, so a hunk's numbers are the ones the agent reads in `gh pr diff`.
function toHunk({ oldStart, oldLines, newStart, newLines, lines }: StructuredPatchHunk): Hunk {
  return {
    oldStart: oldLines === 0 ? oldStart - 1 : oldStart,
    oldLines,
    newStart: newLines === 0 ? newStart - 1 : newStart,
    newLines,
    lines,
  };
}

// jsdiff keeps git's a/ and b/ prefixes. A git diff always names both sides, using
// /dev/null for the side that does not exist, and that side is never the one read.
function withoutPrefix(name: string | undefined): string {
  if (name === undefined) throw new Error("The diff has a file with no name.");
  return name.replace(/^[ab]\//, "");
}

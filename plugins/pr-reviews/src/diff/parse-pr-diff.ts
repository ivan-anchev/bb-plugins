// Boundary: `gh pr diff` text to canonical DiffFiles. Server only, since it bundles jsdiff.
import { parsePatch, type StructuredPatch, type StructuredPatchHunk } from "diff";
import type { DiffFile, Hunk } from "./diff-schema.ts";

/** Throws when a hunk's line counts disagree with its header, as in a truncated diff, or a file name can't be read. */
export function parsePrDiff(text: string): DiffFile[] {
  return fileSections(text).map(toDiffFile);
}

// One file's lines each, from its `diff --git` line to the next file's. A hunk line starts
// with a space, `+`, `-` or `\`, so it never starts a file. Nothing precedes the first file.
function fileSections(text: string): string[][] {
  const sections: string[][] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) sections.push([]);
    sections.at(-1)?.push(line);
  }
  return sections;
}

// jsdiff reads the hunks and the kind of change. It also reads file names, but trims them,
// drops a byte-order mark, and cuts a name at U+2028 or U+2029, so they are read here.
function toDiffFile(lines: string[]): DiffFile {
  const [patch] = parsePatch(lines.join("\n"));
  return {
    ...pathsOf(lines),
    status: statusOf(patch),
    binary: patch.isBinary === true,
    hunks: patch.hunks.map(toHunk),
  };
}

// git names a file exactly in `rename from`/`rename to` or `copy to`, and otherwise in its
// `diff --git` line. Those keys start no hunk line, so the whole section can be searched.
function pathsOf([gitHeader, ...lines]: string[]): Pick<DiffFile, "path" | "previousPath"> {
  const field = (key: string) => lines.find((line) => line.startsWith(key))?.slice(key.length);
  const renamedFrom = field("rename from ");
  const target = field("rename to ") ?? field("copy to ");
  return {
    path: target === undefined ? samePathOf(gitHeader) : unquoted(target),
    previousPath: renamedFrom === undefined ? null : unquoted(renamedFrom),
  };
}

// Without a rename or copy, `diff --git a/<path> b/<path>` writes the same text on both
// sides, so it splits at its middle, whatever the path holds.
function samePathOf(gitHeader: string): string {
  const sides = gitHeader.slice("diff --git ".length);
  const middle = (sides.length - 1) / 2;
  const [oldSide, newSide] = [sides.slice(0, middle), sides.slice(middle + 1)].map(unquoted);
  if (sides[middle] !== " " || !oldSide.startsWith("a/") || newSide !== `b/${oldSide.slice(2)}`) {
    throw new Error(`Can't read the file name in: ${gitHeader}`);
  }
  return oldSide.slice(2);
}

// git C-quotes a name that holds a control character, `"` or `\`, and by default any
// non-ASCII byte; each escape is one byte of the name's UTF-8. Other names are written raw.
const QUOTED_NAME = /^"(?:[^"\\]|\\[abtnvfr"\\]|\\[0-7]{3})*"$/;
const QUOTED_PART = /\\([0-7]{3}|.)|[^\\]+/g;
const CONTROL_ESCAPES = new Map([["a", 7], ["b", 8], ["t", 9], ["n", 10], ["v", 11], ["f", 12], ["r", 13]]);
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", { ignoreBOM: true });

function unquoted(name: string): string {
  if (!name.startsWith('"')) return name;
  if (!QUOTED_NAME.test(name)) throw new Error(`Can't read the quoted file name ${name}`);
  const bytes = [...name.slice(1, -1).matchAll(QUOTED_PART)].flatMap(([part, escape]) =>
    escape === undefined ? [...ENCODER.encode(part)] : [byteOf(escape)],
  );
  return DECODER.decode(Uint8Array.from(bytes));
}

// An escaped `"` or `\` is its own byte.
const byteOf = (escape: string) =>
  escape.length === 3 ? parseInt(escape, 8) : (CONTROL_ESCAPES.get(escape) ?? escape.charCodeAt(0));

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

// A hunk as experimental_Diff input, and the slices of a hunk a step draws a finding between.
// Shared: the app renders each hunk of a step on its own.
import { firstLinesOf, hunkIdOf, type Hunk } from "./diff-schema.ts";

/** A headerless single-hunk patch; experimental_Diff completes it from its `path` prop. */
export function hunkToPatch(hunk: Hunk): string {
  return `${hunkIdOf(hunk)}\n${hunk.lines.join("\n")}\n`;
}

/**
 * Lines `[from, to)` of `hunk` as a hunk of their own, with a header valid for them: each side
 * starts at the hunk's first line on that side plus that side's lines before `from`, each count is
 * that side's lines kept, and an empty side writes the line before it as its start, as git does.
 */
export function sliceHunk(hunk: Hunk, from: number, to: number): Hunk {
  const before = hunk.lines.slice(0, from);
  const lines = hunk.lines.slice(from, to);
  const first = firstLinesOf(hunk);
  const oldLines = lines.filter(isOldLine).length;
  const newLines = lines.filter(isNewLine).length;
  return {
    oldStart: startOf(first.old + before.filter(isOldLine).length, oldLines),
    oldLines,
    newStart: startOf(first.new + before.filter(isNewLine).length, newLines),
    newLines,
    lines,
  };
}

/**
 * Where to cut the hunk just after the line at `index`, without splitting what experimental_Diff
 * draws as one: a `\ No newline` marker stays with its line, and a removed line in a run of
 * removals followed by a run of additions cuts after the whole run, since the diff pairs the two
 * runs to highlight the words that changed.
 */
export function cutAfter(hunk: Hunk, index: number): number {
  const { lines } = hunk;
  if (lines[index]?.[0] === "-") {
    const afterRemoved = endOfRun(lines, index, "-");
    if (lines[afterRemoved]?.[0] === "+") return endOfRun(lines, afterRemoved, "+");
  }
  return lines[index + 1]?.startsWith("\\") ? index + 2 : index + 1;
}

// Just past the lines from `from` on that start with `sign`, with any `\ No newline` marker among them.
function endOfRun(lines: string[], from: number, sign: "-" | "+"): number {
  let end = from;
  while (lines[end]?.[0] === sign || lines[end]?.[0] === "\\") end++;
  return end;
}

const isOldLine = (line: string) => line[0] === " " || line[0] === "-";
const isNewLine = (line: string) => line[0] === " " || line[0] === "+";
const startOf = (firstLine: number, count: number) => (count === 0 ? firstLine - 1 : firstLine);

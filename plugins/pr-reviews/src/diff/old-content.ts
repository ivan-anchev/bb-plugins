// A changed file's old text, rebuilt from its new text and its diff. Between and around the hunks
// both sides are the same lines, and each hunk holds the old side's lines where it is, so the new
// side and the patch are the whole old side: no read of the base commit, and no merge base to find.
// Pure.
import { firstLinesOf, type DiffFile, type Hunk } from "./diff-schema.ts";

/** The text `file` had before its change, given the text it has after. Meaningless for a binary file. */
export function oldContentOf(file: DiffFile, newContent: string): string {
  const newLines = newContent.split("\n");
  // A final newline leaves an empty string after the last line; it is the line ending, not a line.
  const newEndsWithNewline = newLines.at(-1) === "";
  if (newEndsWithNewline) newLines.pop();

  const oldLines: string[] = [];
  let next = 0;
  let oldEndsWithNewline = newEndsWithNewline;
  for (const hunk of file.hunks) {
    const start = firstLinesOf(hunk).new - 1;
    oldLines.push(...newLines.slice(next, start), ...hunk.lines.filter(isOldLine).map((line) => line.slice(1)));
    next = start + hunk.newLines;
    // A hunk that reaches the end of the file says how the old side ends; otherwise the end is shared.
    if (next === newLines.length) oldEndsWithNewline = !oldSideLacksFinalNewline(hunk);
  }
  oldLines.push(...newLines.slice(next));
  return oldLines.join("\n") + (oldEndsWithNewline && oldLines.length > 0 ? "\n" : "");
}

const isOldLine = (line: string) => line[0] === " " || line[0] === "-";

// git writes `\ No newline at end of file` after the last line of a side that has none.
function oldSideLacksFinalNewline({ lines }: Hunk): boolean {
  return lines.some((line, index) => line[0] === "\\" && index > 0 && isOldLine(lines[index - 1]));
}

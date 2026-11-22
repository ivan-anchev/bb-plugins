import { firstLinesOf, type DiffFile, type Hunk } from "./diff-schema.ts";

/** The text `file` had before its change, given the text it has after. Meaningless for a binary file. */
export function oldContentOf(file: DiffFile, newContent: string): string {
  const newLines = newContent.split("\n");
  const newEndsWithNewline = newLines.at(-1) === "";
  if (newEndsWithNewline) newLines.pop();

  const oldLines: string[] = [];
  let next = 0;
  let oldEndsWithNewline = newEndsWithNewline;
  for (const hunk of file.hunks) {
    const start = firstLinesOf(hunk).new - 1;
    oldLines.push(...newLines.slice(next, start), ...hunk.lines.filter(isOldLine).map((line) => line.slice(1)));
    next = start + hunk.newLines;
    if (next === newLines.length) oldEndsWithNewline = !oldSideLacksFinalNewline(hunk);
  }
  oldLines.push(...newLines.slice(next));
  return oldLines.join("\n") + (oldEndsWithNewline && oldLines.length > 0 ? "\n" : "");
}

const isOldLine = (line: string) => line[0] === " " || line[0] === "-";

function oldSideLacksFinalNewline({ lines }: Hunk): boolean {
  return lines.some((line, index) => line[0] === "\\" && index > 0 && isOldLine(lines[index - 1]));
}

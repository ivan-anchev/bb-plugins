// A file's diff as the rows a diff draws, each with its number on every side it is on: the one
// place that knows how a drawn line maps to the PR's hunks. Selections resolve to rows here, and
// the row decides the side GitHub anchors to. Pure.
import { firstLinesOf, numberedLines, type DiffFile, type DiffSide, type Hunk, type NumberedLine } from "./diff-schema.ts";

/**
 * One drawn row. `text` keeps its diff prefix (" ", "-", "+"). `hunk` is the index in
 * `file.hunks`; null for an unchanged line between or around the hunks, drawn only once the
 * file's text is known and the reader expands it.
 */
export type DiffRow =
  | { kind: "unchanged"; old: number; new: number; text: string; hunk: number | null }
  | { kind: "removed"; old: number; new: null; text: string; hunk: number }
  | { kind: "added"; old: null; new: number; text: string; hunk: number };

/**
 * The rows of `file` in diff order. Without `newContent`, only its hunks' rows, as a patch draws
 * them. With it, every line of the file: the unchanged lines around the hunks too, numbered on the
 * old side by the lines the hunks before them added and removed.
 */
export function diffRowsOf(file: DiffFile, newContent: string | null): DiffRow[] {
  if (newContent === null) return file.hunks.flatMap(hunkRows);
  const newLines = linesOf(newContent);
  const rows: DiffRow[] = [];
  let nextNew = 1;
  let shift = 0; // the new side's lines minus the old side's, over the hunks so far
  file.hunks.forEach((hunk, index) => {
    for (const end = firstLinesOf(hunk).new; nextNew < end; nextNew++) rows.push(unchangedRow(newLines, nextNew, shift));
    rows.push(...hunkRows(hunk, index));
    nextNew = firstLinesOf(hunk).new + hunk.newLines;
    shift += hunk.newLines - hunk.oldLines;
  });
  for (; nextNew <= newLines.length; nextNew++) rows.push(unchangedRow(newLines, nextNew, shift));
  return rows;
}

/**
 * The index of the row with `line` on `side`. An unchanged line matches by either of its
 * numbers, so a point on the old side of a context line (split view's left column) finds the same
 * row as its new side.
 */
// why throw: the diff only reports lines it drew, and it drew exactly these rows, so a miss is a
// bug to fail loudly on, as fileOf and hunkOf do.
export function rowIndexOf(rows: readonly DiffRow[], side: DiffSide, line: number): number {
  const index = rows.findIndex((row) => row[side] === line);
  if (index === -1) throw new Error(`No drawn row has line ${line} on the ${side} side`);
  return index;
}

// The `\ No newline` marker is on neither side, so it is not a row.
const hunkRows = (hunk: Hunk, index: number): DiffRow[] => numberedLines(hunk).flatMap((line) => rowsOf(line, index));

function rowsOf({ text, old, new: next }: NumberedLine, hunk: number): DiffRow[] {
  if (old !== null && next !== null) return [{ kind: "unchanged", old, new: next, text, hunk }];
  if (old !== null) return [{ kind: "removed", old, new: null, text, hunk }];
  if (next !== null) return [{ kind: "added", old: null, new: next, text, hunk }];
  return [];
}

const unchangedRow = (newLines: readonly string[], line: number, shift: number): DiffRow => ({
  kind: "unchanged",
  old: line - shift,
  new: line,
  text: ` ${newLines[line - 1]}`,
  hunk: null,
});

// A final newline ends the last line; it is not an empty line after it (as in old-content.ts).
function linesOf(content: string): string[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

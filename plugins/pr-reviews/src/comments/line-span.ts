// What a selection points at: a run of one drawn file's rows at one commit. Turns the two points
// the reader picked into that run, and the run into its anchor lines, its quote and the label every
// surface shows. Pure.
import { rowIndexOf, type DiffRow } from "../diff/diff-rows.ts";
import type { CodeQuote, LineRef } from "./comment-schema.ts";

/** Contiguous rows of the file at `path`, as drawn at `commit`, in diff order. Never empty. */
export type LineSpan = { path: string; commit: string; rows: readonly [DiffRow, ...DiffRow[]] };

/**
 * The rows from one point to the other, whichever comes first in the diff: a drag can run upward,
 * and in split view from one column to the other. Each point is a number on a side as the diff
 * reported it; rowIndexOf finds a context line from either side.
 */
export function spanBetween(path: string, commit: string, rows: readonly DiffRow[], a: LineRef, b: LineRef): LineSpan {
  const [from, to] = [rowIndexOf(rows, a.side, a.line), rowIndexOf(rows, b.side, b.line)].sort((x, y) => x - y);
  return { path, commit, rows: [rows[from], ...rows.slice(from + 1, to + 1)] };
}

/** The side and number GitHub anchors a row to: the old side only for a removed line. */
export const refOf = (row: DiffRow): LineRef => (row.new === null ? { side: "old", line: row.old } : { side: "new", line: row.new });

/** Whether every row is in the same one of the PR's hunks: the only lines GitHub takes a line comment on. */
export function inOneHunk({ rows }: LineSpan): boolean {
  const { hunk } = rows[0];
  return hunk !== null && rows.every((row) => row.hunk === hunk);
}

export function quoteOf({ path, commit, rows }: LineSpan): CodeQuote {
  return { path, commit, start: refOf(rows[0]), end: refOf(rows[rows.length - 1]), lines: rows.map((row) => row.text) };
}

/** "line 12 (new)", "lines 26–31 (old)", "line 26 (old) to line 63 (new)". */
export function linesLabel(start: LineRef, end: LineRef): string {
  if (start.side !== end.side) return `line ${start.line} (${start.side}) to line ${end.line} (${end.side})`;
  if (start.line === end.line) return `line ${end.line} (${end.side})`;
  return `lines ${start.line}–${end.line} (${end.side})`;
}

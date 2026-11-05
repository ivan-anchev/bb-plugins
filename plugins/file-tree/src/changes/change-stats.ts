import type { ChangedFile } from "../git.ts";

export type LineStats = { insertions: number; deletions: number };

export type StatPart = { text: string; tone: "added" | "removed" | "muted" };

export type ChangeSummary = { text: string; stats: LineStats | null; title: string };

type ShownChanges = { shown: readonly ChangedFile[]; totalCount: number; truncated: boolean; filtering: boolean };

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function fileStatPartsOf(file: ChangedFile): StatPart[] {
  if (file.binary) return [{ text: "Binary", tone: "muted" }];
  switch (file.changeKind) {
    case "added":
      return file.additions > 0 ? [insertionPart(file.additions)] : [];
    case "deleted":
      return file.deletions > 0 ? [deletionPart(file.deletions)] : [];
    default:
      return [insertionPart(file.additions), deletionPart(file.deletions)];
  }
}

export function lineStatPartsOf(stats: LineStats): StatPart[] {
  return [insertionPart(stats.insertions), deletionPart(stats.deletions)];
}

export function changeSummaryOf({ shown, totalCount, truncated, filtering }: ShownChanges): ChangeSummary {
  const stats = totalStatsOf(shown);
  const changed = stats.insertions > 0 || stats.deletions > 0;
  const visibleStats = changed ? stats : null;
  const more = truncated ? "+" : "";
  if (filtering) {
    return {
      text: `${shown.length} of ${totalCount}${more} files${changed ? " · " : ""}`,
      stats: visibleStats,
      title: `${shown.length} of ${totalCount}${more} changed files match the filter`,
    };
  }
  if (truncated) {
    return {
      text: `${shown.length}+ ${filesWord(shown.length)}${changed ? " · shown " : ""}`,
      stats: visibleStats,
      title: `Showing the first ${filesOf(shown.length)}; shown slice: ${countOf(stats.insertions, "insertion")}, ${countOf(stats.deletions, "deletion")}`,
    };
  }
  if (shown.length === 0) return { text: "No changes", stats: null, title: "No changes" };
  return changed
    ? { text: `${filesOf(shown.length)}, `, stats, title: `${filesOf(shown.length)}, ${plainTextOf(lineStatPartsOf(stats))}` }
    : { text: filesOf(shown.length), stats: null, title: filesOf(shown.length) };
}

export function plainTextOf(parts: readonly StatPart[]): string {
  return parts.map((part) => part.text).join(" ");
}

function totalStatsOf(files: readonly ChangedFile[]): LineStats {
  return {
    insertions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

function insertionPart(count: number): StatPart {
  return { text: `+${COUNT_FORMAT.format(count)}`, tone: "added" };
}

function deletionPart(count: number): StatPart {
  return { text: `-${COUNT_FORMAT.format(count)}`, tone: "removed" };
}

function filesOf(count: number): string {
  return `${count} ${filesWord(count)}`;
}

function filesWord(count: number): string {
  return count === 1 ? "file" : "files";
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

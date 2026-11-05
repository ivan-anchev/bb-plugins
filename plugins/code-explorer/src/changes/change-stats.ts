import type { ChangedFile } from "../git.ts";
import { CHANGE_KINDS, changeKindOf, type ChangeKind } from "./change-kind.ts";

export type LineStats = { insertions: number; deletions: number };

export type StatPart = { text: string; tone: "added" | "removed" | "muted" };

export type KindBreakdown = { rows: { kind: ChangeKind; stats: LineStats }[]; totalLabel: string };

export type ChangeSummary = Headline & { breakdown: KindBreakdown };

type Headline = { text: string; stats: LineStats | null; title: string };

type SummarizedChanges = {
  files: readonly ChangedFile[];
  shown: readonly ChangedFile[];
  truncated: boolean;
  filtering: boolean;
};

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

export function changeSummaryOf(changes: SummarizedChanges): ChangeSummary {
  const stats = totalStatsOf(changes.files);
  return { ...headlineOf(changes, stats), breakdown: kindBreakdownOf(changes.files, changes.truncated) };
}

export function plainTextOf(parts: readonly StatPart[]): string {
  return parts.map((part) => part.text).join(" ");
}

function headlineOf({ files, shown, truncated, filtering }: SummarizedChanges, stats: LineStats): Headline {
  const changed = hasLines(stats);
  const visibleStats = changed ? stats : null;
  const statsLead = changed ? (truncated ? " · shown " : " · ") : "";
  if (filtering) {
    const matching = `${shown.length} of ${files.length}${truncated ? "+" : ""}`;
    return {
      text: `${matching} files${statsLead}`,
      stats: visibleStats,
      title: `${matching} changed files match the filter`,
    };
  }
  if (truncated) {
    return {
      text: `${files.length}+ ${filesWord(files.length)}${statsLead}`,
      stats: visibleStats,
      title: `Showing the first ${filesOf(files.length)}; shown slice: ${countOf(stats.insertions, "insertion")}, ${countOf(stats.deletions, "deletion")}`,
    };
  }
  if (files.length === 0) return { text: "No changes", stats: null, title: "No changes" };
  return changed
    ? { text: `${filesOf(files.length)}, `, stats, title: `${filesOf(files.length)}, ${plainTextOf(lineStatPartsOf(stats))}` }
    : { text: filesOf(files.length), stats: null, title: filesOf(files.length) };
}

function kindBreakdownOf(files: readonly ChangedFile[], truncated: boolean): KindBreakdown {
  const rows = CHANGE_KINDS.map((kind) => ({
    kind,
    stats: totalStatsOf(files.filter((file) => changeKindOf(file.path) === kind)),
  }));
  return { rows: rows.filter((row) => hasLines(row.stats)), totalLabel: truncated ? "Shown slice" : "Total" };
}

function totalStatsOf(files: readonly ChangedFile[]): LineStats {
  return {
    insertions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

function hasLines(stats: LineStats): boolean {
  return stats.insertions > 0 || stats.deletions > 0;
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

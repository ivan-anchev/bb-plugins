// The Changes tab's numbers (ported from code-explorer's change-stats): a file's `+N −M`, and the
// header's summary of the whole PR with its per-kind breakdown. Pure. A PR's diff is never cut
// short (the server refuses one), so there is no truncated list to account for.
import { fileLineCountsOf, type DiffFile, type LineCounts } from "../../diff/diff-schema.ts";
import { CHANGE_KINDS, changeKindOf, type ChangeKind } from "../../guide/change-kind.ts";

export type StatPart = { text: string; tone: "added" | "removed" | "muted" };

export type KindBreakdown = { kind: ChangeKind; counts: LineCounts }[];

export type ChangeSummary = Headline & { breakdown: KindBreakdown };

type Headline = { text: string; counts: LineCounts | null; title: string };

type SummarizedChanges = { files: readonly DiffFile[]; shown: readonly DiffFile[]; filtering: boolean };

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

// An added file only adds and a deleted one only removes, so each shows its one side; any other
// file shows both, zeros included.
export function fileStatPartsOf(file: DiffFile): StatPart[] {
  if (file.binary) return [{ text: "Binary", tone: "muted" }];
  const { added, removed } = fileLineCountsOf(file);
  switch (file.status) {
    case "added":
      return added > 0 ? [addedPart(added)] : [];
    case "deleted":
      return removed > 0 ? [removedPart(removed)] : [];
    case "modified":
    case "renamed":
      return lineStatPartsOf({ added, removed });
    default:
      return file.status satisfies never;
  }
}

export function lineStatPartsOf({ added, removed }: LineCounts): StatPart[] {
  return [addedPart(added), removedPart(removed)];
}

export function changeSummaryOf(changes: SummarizedChanges): ChangeSummary {
  return { ...headlineOf(changes, totalCountsOf(changes.files)), breakdown: kindBreakdownOf(changes.files) };
}

export function plainTextOf(parts: readonly StatPart[]): string {
  return parts.map((part) => part.text).join(" ");
}

// The line counts are always the whole PR's; a filter only changes how many files it names.
function headlineOf({ files, shown, filtering }: SummarizedChanges, counts: LineCounts): Headline {
  const changed = hasLines(counts);
  const shownCounts = changed ? counts : null;
  if (filtering) {
    const matching = `${shown.length} of ${files.length}`;
    return { text: `${matching} files${changed ? " · " : ""}`, counts: shownCounts, title: `${matching} changed files match the filter` };
  }
  if (files.length === 0) return { text: "No changes", counts: null, title: "No changes" };
  return changed
    ? { text: `${filesOf(files.length)}, `, counts, title: `${filesOf(files.length)}, ${plainTextOf(lineStatPartsOf(counts))}` }
    : { text: filesOf(files.length), counts: null, title: filesOf(files.length) };
}

function kindBreakdownOf(files: readonly DiffFile[]): KindBreakdown {
  const rows = CHANGE_KINDS.map((kind) => ({ kind, counts: totalCountsOf(files.filter((file) => changeKindOf(file.path) === kind)) }));
  return rows.filter((row) => hasLines(row.counts));
}

function totalCountsOf(files: readonly DiffFile[]): LineCounts {
  const counts = files.map(fileLineCountsOf);
  return { added: counts.reduce((sum, each) => sum + each.added, 0), removed: counts.reduce((sum, each) => sum + each.removed, 0) };
}

const hasLines = ({ added, removed }: LineCounts): boolean => added > 0 || removed > 0;

// U+2212 for the minus, as everywhere else on the PR page.
const addedPart = (count: number): StatPart => ({ text: `+${COUNT_FORMAT.format(count)}`, tone: "added" });
const removedPart = (count: number): StatPart => ({ text: `−${COUNT_FORMAT.format(count)}`, tone: "removed" });

const filesOf = (count: number): string => `${count} ${count === 1 ? "file" : "files"}`;

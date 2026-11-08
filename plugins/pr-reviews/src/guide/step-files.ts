// The files one walkthrough step touches, with the lines the step's own hunks add and remove
// and whether the PR adds, deletes or changes each. Pure; the step page lists them beside its diffs.
import { fileOf, hunkOf, lineCountsOf, WHOLE_FILE, type DiffFile } from "../diff/diff-schema.ts";
import type { GuideHunk, GuideStep } from "./guide-schema.ts";

/** A file in a step, counted over the step's hunks of it only. `status` is the PR's, for the whole file. */
export type StepFile = { path: string; status: DiffFile["status"]; added: number; removed: number };

/**
 * One entry per file, in the order the step first shows it. Pass the step as the walkthrough
 * shows it (`visibleSteps`), so hunks the view options hide are not counted. A folded hunk is
 * still on the page and counts; a whole-file unit has no lines.
 */
export function stepFilesOf(step: GuideStep, files: DiffFile[]): StepFile[] {
  const byPath = new Map<string, StepFile>();
  for (const entry of step.hunks) {
    const file = fileOf(files, entry.file);
    const counted = byPath.get(entry.file) ?? { path: entry.file, status: file.status, added: 0, removed: 0 };
    const { added, removed } = lineCountsOf(linesOf(file, entry));
    byPath.set(entry.file, { ...counted, added: counted.added + added, removed: counted.removed + removed });
  }
  return [...byPath.values()];
}

const linesOf = (file: DiffFile, entry: GuideHunk): string[] => (entry.hunk === WHOLE_FILE ? [] : hunkOf(file, entry.hunk).lines);

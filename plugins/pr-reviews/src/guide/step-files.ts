// The files one walkthrough step touches, with the lines the step's own hunks add and remove.
// Pure; the step page lists them beside its diffs.
import { fileOf, hunkOf, WHOLE_FILE, type DiffFile } from "../diff/diff-schema.ts";
import type { GuideHunk, GuideStep } from "./guide-schema.ts";

/** A file in a step, counted over the step's hunks of it only. */
export type StepFile = { path: string; added: number; removed: number };

/**
 * One entry per file, in the order the step first shows it. Pass the step as the walkthrough
 * shows it (`visibleSteps`), so hunks the view options hide are not counted. A folded hunk is
 * still on the page and counts; a whole-file unit has no lines.
 */
export function stepFilesOf(step: GuideStep, files: DiffFile[]): StepFile[] {
  const byPath = new Map<string, StepFile>();
  for (const entry of step.hunks) {
    const counted = byPath.get(entry.file) ?? { path: entry.file, added: 0, removed: 0 };
    const lines = linesOf(files, entry);
    byPath.set(entry.file, {
      path: entry.file,
      added: counted.added + lines.filter((line) => line.startsWith("+")).length,
      removed: counted.removed + lines.filter((line) => line.startsWith("-")).length,
    });
  }
  return [...byPath.values()];
}

const linesOf = (files: DiffFile[], entry: GuideHunk): string[] =>
  entry.hunk === WHOLE_FILE ? [] : hunkOf(fileOf(files, entry.file), entry.hunk).lines;

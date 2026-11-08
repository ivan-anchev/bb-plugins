// A DiffFile for the Changes tab's tests, built from the line counts a test cares about: one hunk
// that removes `removed` lines and adds `added`, or no hunk when both are zero.
import type { DiffFile, LineCounts } from "../../diff/diff-schema.ts";

type DiffFileFixture = Partial<Omit<DiffFile, "path" | "hunks"> & LineCounts>;

export function diffFile(path: string, { added = 1, removed = 1, ...file }: DiffFileFixture = {}): DiffFile {
  const lines = [...Array<string>(removed).fill("-old"), ...Array<string>(added).fill("+new")];
  const hunks = lines.length === 0 ? [] : [{ oldStart: 1, oldLines: removed, newStart: 1, newLines: added, lines }];
  return { path, previousPath: null, status: "modified", binary: false, hunks, ...file };
}

// What the Changes tab's viewer shows for a file (code-explorer's viewer-input notice rules): its
// patch, and whether its unchanged lines can expand, or a notice where a diff would be empty. Pure.
import { fileLineCountsOf, type DiffFile } from "../../diff/diff-schema.ts";

/** `expandable`: whether the patch leaves out unchanged lines to expand. An added or a deleted file's patch is the whole file. */
type DiffSource = { kind: "patch"; expandable: boolean } | { kind: "notice"; message: string };

export function diffSourceOf(file: DiffFile): DiffSource {
  if (file.binary) return { kind: "notice", message: "Binary file. There is no text diff to show." };
  const { added, removed } = fileLineCountsOf(file);
  if (added + removed === 0) return { kind: "notice", message: unchangedContentsMessageOf(file) };
  return { kind: "patch", expandable: file.status === "modified" || file.status === "renamed" };
}

// Display only: the path is shown as the diff wrote it.
function unchangedContentsMessageOf(file: DiffFile): string {
  return file.previousPath === null ? "No text changes." : `Renamed from ${file.previousPath}. The contents are unchanged.`;
}

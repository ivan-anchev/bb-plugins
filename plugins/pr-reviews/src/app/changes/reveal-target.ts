// Where the Changes panel shows a thread the Summary tab asked for: at its file's row in the tree,
// a row the filters hide once they are cleared, and nowhere once the file has left the diff. Pure.
import type { DiffFile } from "../../diff/diff-schema.ts";
import { filesByTreePathOf } from "./tree/tree-input.ts";

/**
 * `shown`: the file's row in the tree as filtered. `filtered-out`: in the diff, but the filters hide
 * it; its row once they are cleared. `absent`: not in the diff, so the thread can't be shown.
 */
export type RevealTarget = { kind: "shown" | "filtered-out"; treePath: string } | { kind: "absent" };

/** `shownByTreePath`: the filtered tree's files. `files`: the whole diff's. */
export function revealTargetOf(path: string, shownByTreePath: ReadonlyMap<string, DiffFile>, files: readonly DiffFile[]): RevealTarget {
  const shown = treePathOf(shownByTreePath, path);
  if (shown !== null) return { kind: "shown", treePath: shown };
  const unfiltered = treePathOf(filesByTreePathOf(files), path);
  return unfiltered === null ? { kind: "absent" } : { kind: "filtered-out", treePath: unfiltered };
}

function treePathOf(filesByTreePath: ReadonlyMap<string, DiffFile>, path: string): string | null {
  for (const [treePath, file] of filesByTreePath) if (file.path === path) return treePath;
  return null;
}

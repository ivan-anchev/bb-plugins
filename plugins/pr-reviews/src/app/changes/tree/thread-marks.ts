// The review-thread mark on the Changes tab's file tree rows: a dot on each file with any of the
// PR's review threads, wherever its diff places them (on a line, at the file, outdated),
// titled with how many. Pure.
import type { ReviewThread } from "../../../comments/thread-schema.ts";
import type { DiffFile } from "../../../diff/diff-schema.ts";

/** A row's mark: its part of the row's decoration, and the words the decoration's title gives it. */
export type ThreadMark = { part: { text: string; color: string }; title: string };

type ThreadTally = { threads: number; open: number };

/**
 * The mark of each tree path whose file has threads. A thread is on the file at the path it names,
 * as that file's diff draws it, so a file on a disambiguated tree path keeps its threads.
 */
export function threadMarksOf(threads: readonly ReviewThread[], filesByTreePath: ReadonlyMap<string, DiffFile>): Map<string, ThreadMark> {
  const treePathOf = new Map([...filesByTreePath].map(([treePath, file]) => [file.path, treePath]));
  const tallies = new Map<string, ThreadTally>();
  for (const thread of threads) {
    const treePath = treePathOf.get(thread.path);
    if (treePath === undefined) continue;
    const { threads: count, open } = tallies.get(treePath) ?? { threads: 0, open: 0 };
    tallies.set(treePath, { threads: count + 1, open: open + (thread.resolvedBy === null ? 1 : 0) });
  }
  return new Map([...tallies].map(([treePath, tally]) => [treePath, markOf(tally)]));
}

// Bright while a thread is open, receding once all are resolved (app.css).
function markOf({ threads, open }: ThreadTally): ThreadMark {
  const noun = threads === 1 ? "comment thread" : "comment threads";
  return {
    part: { text: "•", color: open > 0 ? "var(--pr-reviews-thread-mark-open)" : "var(--pr-reviews-thread-mark-resolved)" },
    title: open === threads ? `${threads} ${noun}` : open === 0 ? `${threads} resolved ${noun}` : `${threads} ${noun}, ${threads - open} resolved`,
  };
}

// The tree's stylesheet for the mark, which draws its "•" as the 6px dot the git lane draws on
// folders (hidden in this tree, tree-view.tsx), in its colour and with the same nudge onto the text's
// x-height. It is pinned to the end of the row's decoration, a row gap after the line stats, which
// keep its room clear: when they drop out whole (tree-view.tsx), the dot stays.
// why a text part drawn as a dot: a tree row has one decoration, text or an icon, and the line stats
// are text. The rule finds the mark by the colour its inline style names.
const MARK = 'span[style*="--pr-reviews-thread-mark"]';
export const THREAD_MARK_CSS =
  `[data-type=item]:has(${MARK}){--pr-reviews-pinned-decoration:calc(6px + var(--trees-item-row-gap))}` +
  `[data-item-section=decoration]:has(${MARK}){position:relative;min-width:var(--pr-reviews-pinned-decoration)}` +
  `[data-item-section=decoration]>span:has(>${MARK}){padding-right:var(--pr-reviews-pinned-decoration)}` +
  `[data-item-section=decoration] ${MARK}{position:absolute;inset-block:0;right:0;margin-block:auto;width:6px;height:6px;overflow:hidden;text-indent:100%;border-radius:50%;background-color:currentColor;transform:translateY(calc(.65ex - 50%))}`;

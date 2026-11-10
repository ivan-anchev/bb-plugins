// Where a file's review threads go in its diff at one commit: under the row their last line is
// on, or at the file, said why. A thread is never dropped: one whose lines this diff doesn't
// draw shows at its file. Pure.
import type { DiffRow } from "../diff/diff-rows.ts";
import type { LineRef } from "./comment-schema.ts";
import { refOf } from "./line-span.ts";
import type { LineAnchor, ReviewThread } from "./thread-schema.ts";

/** A thread under the row of its last line: `at` is that row's anchor, `hunk` the row's hunk, `lines` the lines it is on in this diff. */
export type LineThread = { thread: ReviewThread; at: LineRef; hunk: number | null; lines: LineAnchor };

/**
 * A thread at its file. `file`: it is on the whole file. `outdated`: GitHub no longer has its lines
 * in the PR's diff. `elsewhere`: its lines are in the diff at another commit than this one.
 * Both of the last carry the lines GitHub last had it on, when it has them.
 */
export type FileThread = { thread: ReviewThread; why: "file" } | { thread: ReviewThread; why: "outdated" | "elsewhere"; last: LineAnchor | null };

export type PlacedThreads = { lines: LineThread[]; file: FileThread[] };

export const NO_THREADS: PlacedThreads = { lines: [], file: [] };

/** The threads on `path` placed in its diff at `commit`, whose drawn rows are `rows`. Other files' threads are left out. */
export function placeThreads(threads: readonly ReviewThread[], path: string, commit: string, rows: readonly DiffRow[]): PlacedThreads {
  const placed: PlacedThreads = { lines: [], file: [] };
  for (const thread of threads) {
    if (thread.path !== path) continue;
    if (thread.subject.kind === "file") {
      placed.file.push({ thread, why: "file" });
      continue;
    }
    const { anchors } = thread.subject;
    const anchor = anchors.find((candidate) => candidate.commit === commit);
    const row = anchor === undefined ? undefined : rows.find((candidate) => candidate[anchor.end.side] === anchor.end.line);
    if (anchor !== undefined && row !== undefined) placed.lines.push({ thread, at: refOf(row), hunk: row.hunk, lines: anchor });
    else placed.file.push({ thread, why: thread.outdated ? "outdated" : "elsewhere", last: anchors[0] ?? null });
  }
  return placed;
}

/** The threads one hunk of the file draws: those on its lines, and the file's own when `withFile` (the file's first hunk shown). */
export const threadsOfHunk = (placed: PlacedThreads, hunk: number, withFile: boolean): PlacedThreads => ({
  lines: placed.lines.filter((thread) => thread.hunk === hunk),
  file: withFile ? placed.file : [],
});

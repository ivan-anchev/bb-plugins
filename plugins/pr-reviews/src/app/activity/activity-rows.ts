// How the Summary tab draws a day of the fold (activity-fold.ts): one row per message or line, side
// by side in one list, a line's tint drawn by the row from where it sits in its block. A review's
// row is keyed by the review in every form it takes, so a refresh or the reader that changes its
// form keeps the row, and the row can hand focus to the form that replaces the one that held it
// (activity-timeline.tsx). Pure.
import type { ActivityBlock, ActivityLine, CommentItem, MergedItem, ReviewWithThreads, RunEntry } from "./activity-fold.ts";

/**
 * A review's form. `message`: on the page, as the fold reads it (a body, or an open thread).
 * `line`: one line of a tinted block. `opened`: a line the reader opened, on the page with Collapse.
 */
export type ReviewForm = "message" | "line" | "opened";

/** Where a row sits in its tinted block: at its top, its bottom, both or neither. */
export type TintEdges = { first: boolean; last: boolean };

/** What a row draws. `key`: its item's, in every form. */
type RowContent =
  | { kind: "comment"; key: string; item: CommentItem }
  | { kind: "review"; key: string; form: ReviewForm; review: ReviewWithThreads }
  | { kind: "run"; key: string; entries: RunEntry[] }
  | { kind: "merged"; key: string; item: MergedItem };

/** `tint`: null for a row on the page. */
export type ActivityRow = RowContent & { tint: TintEdges | null };

/** `opened`: the keys of the lines the reader opened. */
export function rowsOf(blocks: readonly ActivityBlock[], opened: ReadonlySet<string>): ActivityRow[] {
  const rows = blocks.flatMap((block): RowContent[] => {
    switch (block.kind) {
      case "comment":
        return [{ kind: "comment", key: block.item.id, item: block.item }];
      case "review":
        return [{ kind: "review", key: block.review.id, form: "message", review: block }];
      case "lines":
        return block.lines.map((line) => lineRowOf(line, opened));
      default:
        return block satisfies never;
    }
  });
  const tinted = rows.map(isTinted);
  return rows.map((row, index) => ({ ...row, tint: tinted[index] ? { first: !tinted[index - 1], last: !tinted[index + 1] } : null }));
}

function lineRowOf(line: ActivityLine, opened: ReadonlySet<string>): RowContent {
  switch (line.kind) {
    case "run":
      return { kind: "run", key: line.key, entries: line.entries };
    case "review":
      return { kind: "review", key: line.review.id, form: opened.has(line.review.id) ? "opened" : "line", review: line };
    case "merged":
      return { kind: "merged", key: line.item.id, item: line.item };
    default:
      return line satisfies never;
  }
}

const isTinted = (row: RowContent) => row.kind === "run" || row.kind === "merged" || (row.kind === "review" && row.form === "line");

import type { GitHubComment, ReviewThread } from "../../comments/thread-schema.ts";

/** What the reader opened: a resolved thread, and a long thread's middle comments. */
export type Opened = { thread: boolean; middle: boolean };

/** A resolved thread's one row, or the comments it shows with `hidden` behind "N more" after the first. */
export type ThreadFold = { kind: "row" } | { kind: "comments"; shown: GitHubComment[]; hidden: number };

const SHOWN_WHOLE = 3;

export function foldOf(thread: ReviewThread, opened: Opened): ThreadFold {
  if (thread.resolvedBy !== null && !opened.thread) return { kind: "row" };
  const { comments } = thread;
  if (opened.middle || comments.length <= SHOWN_WHOLE) return { kind: "comments", shown: comments, hidden: 0 };
  return { kind: "comments", shown: [comments[0], comments[comments.length - 1]], hidden: comments.length - 2 };
}

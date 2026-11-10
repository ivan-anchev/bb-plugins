// One diff's selected lines and its comment box: lines picked with the diff's gestures or a
// finding's buttons, a review thread's reply, the draft the box holds, and the box closing.
import { useMemo, useRef, useState, type RefObject } from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import type { LineRef } from "../../comments/comment-schema.ts";
import { linesPicked, linesPicking, NO_LINES, openedForReply, openedFromFinding, settled, type BoxOutcome, type DiffLines, type LineBox } from "./line-selection.ts";

/** What the diff reports as the reader picks lines. Stable: it is part of the diff's memoised options. */
export type LineGestures = { picking(range: SelectedLineRange | null): void; picked(range: SelectedLineRange | null): void };

/**
 * A finding's button opening the box under the finding's line: `finding` is its index in the
 * guide, `prefill` the text for an empty draft, and `from` the button, which takes focus back
 * when the box closes.
 */
export type FindingBoxRequest = { at: LineRef; finding: number; prefill: string; from: HTMLElement };

/** Pierre's name for a side: deletions is the old side, additions the new. */
export const pierreSideOf = (ref: LineRef): "deletions" | "additions" => (ref.side === "old" ? "deletions" : "additions");

/** A thread's Reply or Quote reply: the thread, the quote for the draft ("" for none), and the button, which takes focus back when the box closes. */
export type ReplyBoxRequest = { threadId: string; quote: string; from: HTMLElement };

/** `root` is the diff's element: focus lands on it when the box closes, unless a button opened the box. */
export function useLineSelection(root: RefObject<HTMLDivElement | null>) {
  const [lines, setLines] = useState<DiffLines>(NO_LINES);
  const opener = useRef<HTMLElement | null>(null);
  const gestures = useMemo<LineGestures>(
    () => ({
      picking: (range) => setLines((current) => linesPicking(current, range)),
      picked: (range) => setLines((current) => linesPicked(current, range)),
    }),
    [],
  );

  return {
    lines,
    gestures,
    setDraft: (draft: string) => setLines((current) => ({ ...current, draft })),
    openFromFinding: ({ at, finding, prefill, from }: FindingBoxRequest) => {
      opener.current = from;
      setLines((current) => openedFromFinding(current, { start: at.line, end: at.line, side: pierreSideOf(at) }, finding, prefill));
    },
    openForReply: ({ threadId, quote, from }: ReplyBoxRequest) => {
      opener.current = from;
      setLines((current) => openedForReply(current, threadId, quote));
    },
    settle: (outcome: BoxOutcome, sent: string) => setLines((current) => settled(current, outcome, sent)),
    /**
     * × or Esc in an empty box, or Done on a box that did its job: the box, its lines and its
     * empty draft go.
     */
    // why move focus: the box unmounts with focus inside it, which would drop to the page body
    // (REVIEW.md). Back to the button that opened it while the box is still that button's.
    close: () => {
      if (root.current!.contains(document.activeElement)) {
        const back = lines.box !== null && openedByButton(lines.box) && opener.current?.isConnected ? opener.current : root.current!;
        back.focus();
      }
      setLines(NO_LINES);
    },
  };
}

// A reply box is always the Reply button's; a box on lines only while a finding's button put it there.
const openedByButton = (box: LineBox) => box.kind === "reply" || box.finding !== null;

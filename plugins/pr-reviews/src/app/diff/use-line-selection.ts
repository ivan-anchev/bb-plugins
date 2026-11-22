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
    close: () => {
      if (root.current!.contains(document.activeElement)) {
        const back = lines.box !== null && openedByButton(lines.box) && opener.current?.isConnected ? opener.current : root.current!;
        back.focus();
      }
      setLines(NO_LINES);
    },
  };
}

const openedByButton = (box: LineBox) => box.kind === "reply" || box.finding !== null;

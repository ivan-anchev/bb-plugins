// One diff's selected lines and its comment box: lines picked with the diff's gestures or a
// finding's buttons, the draft the box holds, and the box closing.
import { useMemo, useRef, useState, type RefObject } from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import type { LineRef } from "../../comments/comment-schema.ts";
import { linesPicked, linesPicking, NO_LINES, openedFromFinding, settled, type BoxOutcome, type DiffLines } from "./line-selection.ts";

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

/** `root` is the diff's element: focus lands on it when the box closes, unless a finding opened the box. */
export function useLineSelection(root: RefObject<HTMLDivElement | null>) {
  const [lines, setLines] = useState<DiffLines>(NO_LINES);
  const findingButton = useRef<HTMLElement | null>(null);
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
      findingButton.current = from;
      setLines((current) => openedFromFinding(current, { start: at.line, end: at.line, side: pierreSideOf(at) }, finding, prefill));
    },
    settle: (outcome: BoxOutcome, sent: string) => setLines((current) => settled(current, outcome, sent)),
    /**
     * × or Esc in an empty box, or Done on a box that did its job: the box, its lines and its
     * empty draft go.
     */
    // why move focus: the box unmounts with focus inside it, which would drop to the page body
    // (REVIEW.md). Back to the finding button that opened it while the box is still that finding's.
    close: () => {
      if (root.current!.contains(document.activeElement)) {
        const back = lines.box !== null && lines.box.finding !== null && findingButton.current?.isConnected ? findingButton.current : root.current!;
        back.focus();
      }
      setLines(NO_LINES);
    },
  };
}

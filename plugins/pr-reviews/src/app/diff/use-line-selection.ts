// One diff's selected lines, picked with the diff's gestures and cleared by Esc or by a click
// outside the diff.
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import { hasBareLines, selectionPicked, selectionWhilePicking, type LineBox, type LineSelection } from "./line-selection.ts";

/** What the diff reports as the reader picks lines. Stable: it is part of the diff's memoised options. */
export type LineGestures = { picking(range: SelectedLineRange | null): void; picked(range: SelectedLineRange | null): void };

/** `root` is the diff's element: clicks inside it keep the selection, and focus lands on it when the panel goes. */
export function useLineSelection(root: RefObject<HTMLDivElement | null>) {
  const [selection, setSelection] = useState<LineSelection>(null);
  const gestures = useMemo<LineGestures>(
    () => ({
      picking: (range) => setSelection((current) => selectionWhilePicking(current, range)),
      picked: (range) => setSelection((current) => selectionPicked(current, range)),
    }),
    [],
  );
  // why focus the diff: the panel unmounts with the selection, and focus inside it would drop to the
  // page body (REVIEW.md).
  const clear = useCallback(() => {
    if (root.current!.contains(document.activeElement)) root.current!.focus();
    setSelection(null);
  }, [root]);
  const forget = useCallback(() => setSelection(null), []);

  const bare = hasBareLines(selection);
  useEscape(bare, clear);
  useClickAway(root, bare, forget);

  return {
    selection,
    gestures,
    openBox: (box: LineBox) => setSelection((current) => current && { ...current, panel: box }),
    closeBox: () => setSelection((current) => current && { ...current, panel: "actions" }),
    clear,
  };
}

// why capture on window, and preventDefault: bb's own Esc leaves the PR page, and it skips an event
// whose default was prevented (spike §4). Only bare lines: with nothing selected no listener is
// attached, and bb's Esc works as before; an open box holds Esc itself (ui/hold-escape.ts).
function useEscape(active: boolean, clear: () => void) {
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      clear();
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [active, clear]);
}

// Only lines with no box open: an open box is never discarded by a stray click. A click inside the
// diff's shadow root reaches this listener retargeted to its host element, which is inside `root`.
function useClickAway(root: RefObject<HTMLDivElement | null>, active: boolean, onAway: () => void) {
  useEffect(() => {
    if (!active) return;
    const listener = (event: PointerEvent) => {
      if (!(event.target instanceof Node && root.current!.contains(event.target))) onAway();
    };
    document.addEventListener("pointerdown", listener, true);
    return () => document.removeEventListener("pointerdown", listener, true);
  }, [root, active, onAway]);
}

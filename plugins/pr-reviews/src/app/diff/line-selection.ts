// The lines selected in one diff, and what is open under them. Pure transitions; the hook in
// use-line-selection.ts holds the state and wires the diff's gestures, the keys and clicks.
import type { SelectedLineRange } from "@pierre/diffs";

/** A box an action opened under the selected lines: a question for the review thread, or a GitHub comment. */
export type LineBox = "ask" | "comment";

/** Under the selected lines: the action row, or the box one of its actions opened. */
export type LinePanel = "actions" | LineBox;

/**
 * `range` is the diff's own report, kept as is so the highlight is exactly what the reader
 * dragged; it becomes rows only where it is read (line-span.ts). `panel` is null while the reader
 * is still picking the lines (a press, a drag in progress): nothing opens under them until they
 * let go, so a drag never runs into a row that appeared under its last line.
 */
export type LineSelection = { range: SelectedLineRange; panel: LinePanel | null } | null;

/** The selection while the reader picks lines: the press of a click or a shift-click, each step of a drag. */
export const selectionWhilePicking = (current: LineSelection, range: SelectedLineRange | null): LineSelection => next(current, range, null);

/** The selection once the reader lets go: the action row under the lines, or nothing when the gesture cleared them. */
export const selectionPicked = (current: LineSelection, range: SelectedLineRange | null): LineSelection => next(current, range, "actions");

/** Whether a box is open under the lines: it keeps them, and a stray click never discards it. */
export const hasOpenBox = (selection: LineSelection) => selection !== null && selection.panel !== null && selection.panel !== "actions";

// An open box keeps its lines: the reader picks others after closing it.
function next(current: LineSelection, range: SelectedLineRange | null, panel: "actions" | null): LineSelection {
  if (hasOpenBox(current)) return current;
  if (range === null) return null;
  if (current !== null && current.panel === panel && sameRange(current.range, range)) return current;
  return { range, panel };
}

/**
 * Lines with no box open under them: Esc or a click outside the diff clears them. With nothing
 * selected, Esc is bb's own; with a box open, the box holds Esc (ui/hold-escape.ts) and keeps its lines.
 */
export const hasBareLines = (selection: LineSelection) => selection !== null && !hasOpenBox(selection);

// The ranges Pierre reports are built one way (`endSide` only when it differs from `side`), so
// equal ranges have equal fields.
const sameRange = (a: SelectedLineRange, b: SelectedLineRange) => a.start === b.start && a.end === b.end && a.side === b.side && a.endSide === b.endSide;

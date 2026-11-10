// The lines selected in one diff, and what is open under them. Pure transitions; the hook in
// use-line-selection.ts holds the state and wires the diff's gestures, the keys and clicks.
import type { SelectedLineRange } from "@pierre/diffs";

/** Under the selected lines: the action row, or the box one of its actions opened. */
export type LinePanel = "actions" | "ask";

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

// An open box keeps its lines: the reader picks others after closing it.
function next(current: LineSelection, range: SelectedLineRange | null, panel: "actions" | null): LineSelection {
  if (current?.panel === "ask") return current;
  if (range === null) return null;
  if (current !== null && current.panel === panel && sameRange(current.range, range)) return current;
  return { range, panel };
}

/**
 * What Esc does. With nothing selected it is bb's own Esc. With lines selected and no box open it
 * clears them. With a box open it is the box's, which closes only an empty box, so a draft is never
 * lost to Esc; either way it must not reach bb, whose Esc leaves the PR page.
 */
export type EscapeAction = "none" | "clear" | "box";

export function escapeActionOf(selection: LineSelection): EscapeAction {
  if (selection === null) return "none";
  return selection.panel === "ask" ? "box" : "clear";
}

// The ranges Pierre reports are built one way (`endSide` only when it differs from `side`), so
// equal ranges have equal fields.
const sameRange = (a: SelectedLineRange, b: SelectedLineRange) => a.start === b.start && a.end === b.end && a.side === b.side && a.endSide === b.endSide;

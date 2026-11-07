// Where the reader is in a guide, and where ← and → take them. Pure; the hook holds the state.
import type { VisibleStep } from "../../guide/walkthrough.ts";

// why the guide index, not the position among shown steps: the view options change which steps
// are shown, and the reader must stay on the same step when they do.
export type Position = { kind: "overview" } | { kind: "step"; index: number };

export const OVERVIEW: Position = { kind: "overview" };

/** The overview's title, which is also where ← from the first step leads. */
export const OVERVIEW_TITLE = "What this PR does";

/** What the page and the controller show for a position. `number` counts from 1. */
export type Place =
  | { kind: "overview"; title: string }
  | { kind: "step"; title: string; step: VisibleStep; number: number; previousTitle: string; nextTitle: string | null };

export function placeOf(steps: VisibleStep[], position: Position): Place {
  const at = shownAt(steps, position);
  if (at === -1) return { kind: "overview", title: OVERVIEW_TITLE };
  return {
    kind: "step",
    title: steps[at].step.title,
    step: steps[at],
    number: at + 1,
    previousTitle: at === 0 ? OVERVIEW_TITLE : steps[at - 1].step.title,
    nextTitle: at === steps.length - 1 ? null : steps[at + 1].step.title,
  };
}

/** → : the next step; the overview after the last one. */
export function nextPosition(steps: VisibleStep[], position: Position): Position {
  return positionAt(steps, shownAt(steps, position) + 1);
}

/** ← : the previous step; the overview before the first one, and the overview stays put. */
export function previousPosition(steps: VisibleStep[], position: Position): Position {
  const at = shownAt(steps, position);
  return at === -1 ? OVERVIEW : positionAt(steps, at - 1);
}

/**
 * Where the reader lands when the shown steps change: the same step, else the nearest earlier
 * shown step, else the overview. `steps` are in guide order.
 */
export function resolvePosition(steps: VisibleStep[], position: Position): Position {
  if (position.kind === "overview") return OVERVIEW;
  return positionAt(steps, steps.filter((shown) => shown.index <= position.index).length - 1);
}

// The position's place among the shown steps; -1 for the overview, or a step not shown.
function shownAt(steps: VisibleStep[], position: Position): number {
  return position.kind === "overview" ? -1 : steps.findIndex((shown) => shown.index === position.index);
}

/** The shown step at `at`, counted from 0; the overview outside the shown steps. */
export function positionAt(steps: VisibleStep[], at: number): Position {
  return at < 0 || at >= steps.length ? OVERVIEW : { kind: "step", index: steps[at].index };
}

// The card's first line under its title: the thread's state and since when, or how soon it wakes, or
// how long ago it moved (P:1232-1240). Pure.
import { lastMoved, type RowModel } from "../model/activity.ts";
import { STATE_NAME, UNDER_WAY, type ZState } from "../model/state.ts";
import { ago, clock } from "../model/time.ts";

/** `lead` in the line's ink, `note` after it in the quieter ink, each part already joined by " · ". */
export type StateLine = { glyph: { kind: "state"; state: ZState } | { kind: "asleep" } | { kind: "clock" }; lead: string; note: string | null };

/**
 * "Working · for 4m", "Completed · 5m ago", "Asleep · wakes at 9:00 AM", or "5m ago". `state` is the
 * one the row shows (an approval asked already applied); `underWaySince` when the list first saw it under way.
 */
export function stateLine(row: RowModel, state: ZState | null, underWaySince: number, now: number): StateLine {
  const wakes = row.asleepUntil === null ? null : `wakes at ${clock(row.asleepUntil)}`;
  if (state === null && wakes !== null) return { glyph: { kind: "asleep" }, lead: "Asleep", note: wakes };
  const moved = since(lastMoved(row.thread), now);
  if (state === null) return { glyph: { kind: "clock" }, lead: moved, note: null };
  const when = UNDER_WAY.has(state) ? `for ${duration(underWaySince, now)}` : moved;
  return { glyph: { kind: "state", state }, lead: STATE_NAME[state], note: wakes === null ? when : `${when} · ${wakes}` };
}

// ------------------------------------------------------------------ layer 2

/** "just now" under a minute, else "5m ago" (Z:ds/session_card.luau:86-87). */
function since(at: number, now: number): string {
  const text = ago(at, now);
  return text === "now" ? "just now" : `${text} ago`;
}

function duration(from: number, now: number): string {
  const text = ago(from, now);
  return text === "now" ? "under a minute" : text;
}

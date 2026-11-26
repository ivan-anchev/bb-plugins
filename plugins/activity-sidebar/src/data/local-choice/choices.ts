// The choices the reader makes on this list, as stored: the open sections, each view's project filter
// and density, and which view shows while there are regional managers.
import { SECTION_KEYS, type SectionKey } from "../../model/activity.ts";

/** Pinned and Activity open, the shelves folded: the list Zeron opens with. */
const OPEN_AT_FIRST: readonly SectionKey[] = ["pinned", "activity"];

/** The open sections, stored as their keys; unknown keys are dropped. */
export function parseOpen(stored: unknown): readonly SectionKey[] {
  return Array.isArray(stored) ? SECTION_KEYS.filter((key) => stored.includes(key)) : OPEN_AT_FIRST;
}

/** The project id a view is narrowed to; null for every project. */
export function parseFilter(stored: unknown): string | null {
  return typeof stored === "string" ? stored : null;
}

/** A line a thread's row (the prototype's default) unless two were chosen. */
export function parseCompact(stored: unknown): boolean {
  return typeof stored === "boolean" ? stored : true;
}

/** A manager's row keeps its latest reply's line under its name unless one line was chosen. */
export function parseManagersCompact(stored: unknown): boolean {
  return stored === true;
}

/** What the sidebar shows while there are regional managers: them, or every other thread. */
export type View = "managers" | "threads";

/** Each view's name, as its tab and its options say it. */
export const VIEW_NAMES: Record<View, string> = { managers: "Managers", threads: "Threads" };

/** The threads, as the sidebar opened before it had managers, unless the managers were chosen. */
export function parseView(stored: unknown): View {
  return stored === "managers" ? "managers" : "threads";
}

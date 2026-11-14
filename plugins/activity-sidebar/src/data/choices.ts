// The choices the reader makes on this list, as stored: the open sections, the project filter and the density.
import { SECTION_KEYS, type SectionKey } from "../model/activity.ts";

/** Pinned and Activity open, the shelves folded: the list Zeron opens with. */
const OPEN_AT_FIRST: readonly SectionKey[] = ["pinned", "activity"];

/** The open sections, stored as their keys; unknown keys are dropped. */
export function parseOpen(stored: unknown): readonly SectionKey[] {
  return Array.isArray(stored) ? SECTION_KEYS.filter((key) => stored.includes(key)) : OPEN_AT_FIRST;
}

/** The project id every section is narrowed to; null for every project. */
export function parseFilter(stored: unknown): string | null {
  return typeof stored === "string" ? stored : null;
}

/** A line a row (the prototype's default, P:326) unless two were chosen. */
export function parseCompact(stored: unknown): boolean {
  return typeof stored === "boolean" ? stored : true;
}

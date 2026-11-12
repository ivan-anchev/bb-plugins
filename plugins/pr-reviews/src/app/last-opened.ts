// The project of the PR page the reader opened last: the one the rail badge counts
// (decisions.md #11). Derived from the visits, so it follows the opening times, not the order
// their writes landed in. Pure.
import type { Visit } from "../contract.ts";

/** The project of the latest of `visits`, or null before any. */
export function lastOpenedProject(visits: readonly Visit[]): string | null {
  const latest = visits.reduce<Visit | null>((last, visit) => (last === null || visit.openedAt > last.openedAt ? visit : last), null);
  return latest?.projectId ?? null;
}

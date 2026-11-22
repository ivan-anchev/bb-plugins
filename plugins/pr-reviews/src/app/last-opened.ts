import type { Visit } from "../contract.ts";

/** The project of the latest of `visits`, or null before any. */
export function lastOpenedProject(visits: readonly Visit[]): string | null {
  const latest = visits.reduce<Visit | null>((last, visit) => (last === null || visit.openedAt > last.openedAt ? visit : last), null);
  return latest?.projectId ?? null;
}

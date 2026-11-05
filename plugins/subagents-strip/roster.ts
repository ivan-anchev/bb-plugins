// What the strip shows: which delegates, the census words, and the elapsed span.
import type { Delegate, DelegateStatus } from "./delegate.ts";

/**
 * The latest delegating turn's delegates, plus any still running from earlier
 * turns, oldest first. The strip's only scope rule.
 */
export function selectRoster(delegates: readonly Delegate[]): Delegate[] {
  const latest = delegates.reduce<Delegate | null>((a, d) => (!a || d.startedAt > a.startedAt ? d : a), null);
  if (!latest) return [];
  return delegates
    .filter((d) => d.turnId === latest.turnId || isRunning(d))
    .toSorted((a, b) => a.startedAt - b.startedAt);
}

export type CensusPart = { status: DelegateStatus; count: number; word: string };

/** "N subagents" then running, done, failed, stopped in that order, zeros omitted. */
export function census(delegates: readonly Delegate[]): { total: number; parts: CensusPart[] } {
  const counts: Record<DelegateStatus, number> = { running: 0, completed: 0, failed: 0, stopped: 0 };
  for (const d of delegates) counts[d.state.status]++;
  const parts = CENSUS_ORDER.filter((status) => counts[status] > 0)
    .map((status) => ({ status, count: counts[status], word: CENSUS_WORD[status] }));
  return { total: delegates.length, parts };
}

/** Wall-clock span from the first start to the last end, or to `now` while any runs. */
export function span(delegates: readonly Delegate[], now: number): number {
  const start = Math.min(...delegates.map((d) => d.startedAt));
  const end = delegates.some(isRunning) ? now : Math.max(...delegates.map(endOf));
  return end - start;
}

export const isRunning = (d: Delegate): boolean => d.state.status === "running";

// ---------------------------------------------------------------- layer 2

const CENSUS_ORDER: readonly DelegateStatus[] = ["running", "completed", "failed", "stopped"];
const CENSUS_WORD: Record<DelegateStatus, string> = { running: "running", completed: "done", failed: "failed", stopped: "stopped" };

const endOf = (d: Delegate): number => (d.state.status === "running" ? d.startedAt : d.state.endedAt);

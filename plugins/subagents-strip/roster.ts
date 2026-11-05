// What the strip shows: which delegates, the census words, the elapsed span,
// each row's detail line and elapsed time, an expanded row's meta line, and
// the status words the strip and the transcript share.
import { formatClockTime, formatDuration } from "./clock.ts";
import type { Delegate, DelegateStatus } from "./delegate.ts";
import { firstLine, stepLabel, trailSteps } from "./steps.ts";

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
  const end = Math.max(...delegates.map((d) => endOf(d, now)));
  return end - start;
}

/** A row's second line: the latest step while running, the outcome once settled. */
export function detailLine(d: Delegate): string {
  switch (d.state.status) {
    case "running": {
      const step = trailSteps(d.steps ?? []).at(-1);
      return step ? stepLabel(step) : "Starting…";
    }
    case "completed": return d.state.report ? firstLine(d.state.report) : "Finished without a report";
    case "failed": return d.state.error ? firstLine(d.state.error) : "Failed";
    case "stopped": return "Stopped";
  }
}

/**
 * An expanded row's meta line, part by part: started 13:58 · ran 4m 48s ·
 * 19 steps · 24 tool calls · 61.2k tokens. "ran" waits for the end, steps
 * need child rows, and the usage parts need a task event that carried usage.
 */
export function metaParts(d: Delegate): string[] {
  const { state, steps, usage } = d;
  return [
    `started ${formatClockTime(d.startedAt)}`,
    ...(state.status === "running" ? [] : [`ran ${formatDuration(state.endedAt - d.startedAt)}`]),
    ...(steps ? [plural(trailSteps(steps).length, "step")] : []),
    ...(usage ? [plural(usage.toolUses, "tool call"), `${formatTokens(usage.totalTokens)} tokens`] : []),
  ];
}

/** One delegate's run time: to `now` while it runs, to its end once settled. */
export function elapsed(d: Delegate, now: number): number {
  return endOf(d, now) - d.startedAt;
}

export const isRunning = (d: Delegate): boolean => d.state.status === "running";

/** A status as one capitalised word: Running, Done, Failed, Stopped. */
export const statusWord = (status: DelegateStatus): string => STATUS_WORD[status];

// ---------------------------------------------------------------- layer 2

const CENSUS_ORDER: readonly DelegateStatus[] = ["running", "completed", "failed", "stopped"];
const CENSUS_WORD: Record<DelegateStatus, string> = { running: "running", completed: "done", failed: "failed", stopped: "stopped" };
const STATUS_WORD: Record<DelegateStatus, string> = { running: "Running", completed: "Done", failed: "Failed", stopped: "Stopped" };

const endOf = (d: Delegate, now: number): number => (d.state.status === "running" ? now : d.state.endedAt);

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** 950 / 61.2k / 1.3M */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`;
}

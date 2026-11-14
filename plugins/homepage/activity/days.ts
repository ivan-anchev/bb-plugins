// Local-day arithmetic and bucketing for the grid: merged PRs per day, and a
// PR count → accent level scale.

export const WEEKS = 26; // six months

export type Level = 0 | 1 | 2 | 3 | 4;

export interface Day {
  /** Local midnight, epoch ms. */
  start: number;
  prs: number;
  lines: number;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Monday-first weekday index, 0..6. */
export function weekday(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

/** The Monday that starts the grid: WEEKS columns, the last one holding `today`. */
export function gridStart(today: number): number {
  return addDays(today, -weekday(today) - (WEEKS - 1) * 7);
}

/** One Day per local day from `from` through `to`, inclusive. */
export function dailyTotals(prs: readonly { mergedAt: number; lines: number }[], from: number, to: number): Day[] {
  const byDay = new Map<number, { prs: number; lines: number }>();
  for (const pr of prs) {
    const k = startOfDay(pr.mergedAt);
    const t = byDay.get(k) ?? { prs: 0, lines: 0 };
    byDay.set(k, { prs: t.prs + 1, lines: t.lines + pr.lines });
  }
  const days: Day[] = [];
  for (let s = from; s <= to; s = addDays(s, 1)) days.push({ start: s, ...(byDay.get(s) ?? { prs: 0, lines: 0 }) });
  return days;
}

/**
 * Quartile thresholds over the non-zero counts, so one 20-PR day does not
 * flatten every ordinary day into the lowest level.
 */
export function levelScale(counts: readonly number[]): (count: number) => Level {
  const nonZero = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return () => 0;
  const quantile = (p: number) => nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))]!;
  const [t1, t2, t3] = [quantile(0.25), quantile(0.5), quantile(0.75)];
  return (c) => (c <= 0 ? 0 : c <= t1 ? 1 : c <= t2 ? 2 : c <= t3 ? 3 : 4);
}

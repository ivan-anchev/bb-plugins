// The spend chart's days. boat meters machine time month to date only, so the plugin reads that meter
// now and then and keeps what it grew by, per UTC day; the days before that can be backfilled from
// boat's own daily numbers. Pure: card.ts reads and stores the history.
import { z } from "zod";
import type { DaySpend } from "../boat/wire.ts";

const DAY_MS = 86_400_000;
/** Days kept: the chart's 30 and a few spare. */
const KEEP_DAYS = 35;

/** One look at boat's meter: the wallet's machine-time dollars this UTC month, read at `at`. */
export interface Reading {
  at: number;
  monthDollars: number;
}

export const spendHistory = z.object({
  /** When the known days begin: recording's start, or the first day backfilled. Earlier days are unknown, not free. */
  since: z.number(),
  last: z.object({ at: z.number(), monthDollars: z.number() }),
  /** Dollars per UTC day (`2026-11-14`) since `since`; a recorded day without an entry spent nothing. */
  days: z.record(z.string(), z.number()),
});

export type SpendHistory = z.output<typeof spendHistory>;

/** One bar of the chart: a UTC day, and its dollars, null before recording began. */
export const spendDay = z.object({ day: z.string(), dollars: z.number().nullable() });

export type SpendDay = z.output<typeof spendDay>;

/**
 * Adds what the meter grew by since the last reading to the reading's day. A gap of days lands on
 * the day it ends; a meter lower than the last reading adds nothing and becomes the new baseline.
 * A reading older than the last one (the server clock set back) changes nothing.
 */
export function record(history: SpendHistory | null, reading: Reading): SpendHistory {
  if (history !== null && reading.at < history.last.at) return history;
  const day = utcDay(reading.at);
  const grew = Math.max(0, reading.monthDollars - meterBefore(history?.last ?? null, reading));
  const days = { ...history?.days, [day]: (history?.days[day] ?? 0) + grew };
  return { since: history?.since ?? reading.at, last: reading, days: recent(days, reading.at) };
}

/** The `count` UTC days ending with `now`'s, oldest first. */
export function spendDays(history: SpendHistory | null, now: number, count: number): SpendDay[] {
  return Array.from({ length: count }, (_, i) => {
    const day = utcDay(now - (count - 1 - i) * DAY_MS);
    return { day, dollars: history === null || day < utcDay(history.since) ? null : (history.days[day] ?? 0) };
  });
}

/**
 * Fills the unrecorded days of the `count` UTC days ending with `now`'s from boat's own numbers, walking
 * back from the day before the known days begin until boat has no number for a day. Known days stay as
 * they are, and days outside the window are ignored. Today is never filled: it is still being recorded,
 * so when it is unknown (the clock set back to before recording began) nothing is. The known days then
 * begin at the first day filled, so a repeat fills nothing.
 */
export function backfill(history: SpendHistory, boat: readonly DaySpend[], now: number, count: number): { history: SpendHistory; filled: number } {
  const boatDollars = new Map(boat.map(({ day, dollars }) => [day, dollars]));
  const today = utcDay(now);
  const unknown = spendDays(history, now, count).filter((day) => day.dollars === null);
  const filled: DaySpend[] = [];
  for (const { day } of unknown.reverse()) {
    const dollars = boatDollars.get(day);
    if (day === today || dollars === undefined) break;
    filled.push({ day, dollars });
  }
  const first = filled.at(-1);
  if (first === undefined) return { history, filled: 0 };
  const days = { ...history.days, ...Object.fromEntries(filled.map(({ day, dollars }) => [day, dollars])) };
  return { history: { ...history, since: Date.parse(first.day), days }, filled: filled.length };
}

/** `2026-11-14`. */
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * The meter at the last point known before `reading`: the last reading of the same month, else zero,
 * where boat starts each month. A first reading ever only sets the baseline, since what the month
 * spent before it is unknown, unless it falls on the 1st, which all started from zero.
 */
function meterBefore(last: Reading | null, reading: Reading): number {
  if (last !== null) return utcDay(last.at).slice(0, 7) === utcDay(reading.at).slice(0, 7) ? last.monthDollars : 0;
  return new Date(reading.at).getUTCDate() === 1 ? 0 : reading.monthDollars;
}

const recent = (days: Record<string, number>, now: number): Record<string, number> => {
  const oldest = utcDay(now - KEEP_DAYS * DAY_MS);
  return Object.fromEntries(Object.entries(days).filter(([day]) => day >= oldest));
};

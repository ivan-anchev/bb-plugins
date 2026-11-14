// Sleep's choices and how a sleeper's corner reads, ported from Zeron (Z:screens/shell/activity.luau
// presets :117-160, wakes_in :92-103). Times are epoch ms; days and hours are the reader's local ones.
import { clock, weekday } from "./time.ts";

export type SleepPreset = { label: string; when: string; until: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Soonest first, one a minute, none already past: in an hour, in three, this evening at 6, tomorrow
 * at 9, next Monday at 9. Each says when it wakes: its time, and its day where its name doesn't.
 */
export function sleepPresets(now: Date): SleepPreset[] {
  const t = now.getTime();
  // why: a week on from a Monday; the coming one from any other day.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  const candidates: [label: string, until: number, namesDay: boolean][] = [
    ["In 1 hour", t + HOUR, false],
    ["In 3 hours", t + 3 * HOUR, false],
    ["This evening", wallClock(now, 0, 18), true],
    ["Tomorrow", wallClock(now, 1, 9), true],
    ["Next week", wallClock(now, toMonday, 9), false],
  ];
  const ahead = candidates.filter(([, until]) => until > t).sort((a, b) => a[1] - b[1]);
  return oneAMinute(ahead).map(([label, until, namesDay]) => ({
    label,
    until,
    when: namesDay || sameDay(until, t) ? clock(until) : `${weekday(until)} ${clock(until)}`,
  }));
}

/** How soon a sleeper wakes, as its corner says it: "45m", "3h", "2d", rounded up, at least "1m". */
export function wakesIn(until: number, now: number): string {
  const left = Math.max(0, until - now);
  if (left < HOUR) return `${Math.max(1, Math.ceil(left / MINUTE))}m`;
  if (left < DAY) return `${Math.ceil(left / HOUR)}h`;
  return `${Math.ceil(left / DAY)}d`;
}

/** Tomorrow at 9 local time, where Custom… opens (Z:screens/shell/sidebar.luau:1183-1186). */
export function tomorrowMorning(now: Date): number {
  return wallClock(now, 1, 9);
}

/**
 * Custom…'s moment from a `datetime-local` value ("2026-11-14T09:00", local time), or null when it is
 * empty or not ahead of `now`: a time that has passed puts nothing to sleep (Z:screens/shell/sidebar.luau:1543-1550).
 */
export function customUntil(value: string, now: number): number | null {
  const until = new Date(value).getTime();
  return Number.isNaN(until) || until <= now ? null : until;
}

/** A moment as a `datetime-local` value: local fields to the minute. */
export function localInputValue(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

// ------------------------------------------------------------------ layer 2

/**
 * `days` after `now` at `hour`:00 on the local wall clock. why: setting local fields, so a DST change
 * between now and then lands on the hour asked for, not an hour off.
 */
function wallClock(now: Date, days: number, hour: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** The first preset of each minute ("In 3 hours" at 6:00 PM and "This evening" read as one). */
function oneAMinute<T extends [string, number, boolean]>(sorted: readonly T[]): T[] {
  const minutes = new Set<number>();
  return sorted.filter(([, until]) => {
    const minute = Math.floor(until / MINUTE);
    if (minutes.has(minute)) return false;
    minutes.add(minute);
    return true;
  });
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

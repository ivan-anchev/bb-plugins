// A reminder the coordinating thread set itself with crew_remind: a note, when it is next due, and
// how often it repeats (null: once). It is the thread's own words, so its doorbell may quote it.
// Times are epoch milliseconds, parsed once from what the thread typed.
import { z } from "zod";
import { ONE_LINE } from "./one-line.ts";

/** A reminder's id: `r1`, `r2`… across every coordinating thread, never reused. */
export const reminderIdSchema = z.string().regex(/^r[1-9][0-9]*$/, "A reminder id is r1, r2 and so on").brand<"reminderId">();
export type ReminderId = z.infer<typeof reminderIdSchema>;

/** why one line: its doorbell quotes it. */
export const reminderNoteSchema = z.string().trim().min(1).max(500).regex(ONE_LINE, "A note is one line");

export type Reminder = { id: ReminderId; note: string; dueAt: number; everyMs: number | null };

type Parsed = { ok: true; ms: number } | { ok: false; error: string };

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
type Unit = keyof typeof UNIT_MS;
const isUnit = (letter: string): letter is Unit => Object.hasOwn(UNIT_MS, letter);

// why at most six digits: a million days keeps every due time, and the next after it, a valid Date.
const DURATION = /^(\d{1,6})\s*([mhd])$/;
// why an offset is required: the thread can't know the bb server's time zone.
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export const AT_FORMS = 'a whole number of minutes, hours or days from now, such as "2m", "in 2h" or "3d", or an ISO 8601 time with its offset, such as "2026-11-16T15:00:00Z" or "2026-11-16T17:00+02:00"';
const EVERY_FORMS = 'a whole number of minutes, hours or days, such as "30m", "2h" or "every 1d"';

/** When a reminder set at `now` first comes due, from `at` as the thread typed it. */
export function parseAt(at: string, now: number): Parsed {
  const text = at.trim();
  const iso = ISO_TIME.exec(text);
  if (iso !== null) {
    const ms = Date.parse(text);
    if (!isOnTheCalendar(iso) || Number.isNaN(ms)) return { ok: false, error: `"${at}" is not a real time. Give at as ${AT_FORMS}.` };
    return ms > now ? { ok: true, ms } : { ok: false, error: `${new Date(ms).toISOString()} is in the past; it is now ${new Date(now).toISOString()}.` };
  }
  const duration = durationMs(text.replace(/^in\s+/i, ""));
  return duration === null ? { ok: false, error: `crew_remind can't read at "${at}". Give it as ${AT_FORMS}.` } : { ok: true, ms: now + duration };
}

/** How often a reminder repeats, from `every` as the thread typed it. */
export function parseEvery(every: string): Parsed {
  const duration = durationMs(every.trim().replace(/^every\s+/i, ""));
  return duration === null ? { ok: false, error: `crew_remind can't read every "${every}". Give it as ${EVERY_FORMS}.` } : { ok: true, ms: duration };
}

/**
 * Whether the day and the time of day an ISO time names exist. why: Date.parse rolls 2027-02-29
 * over to March 1, and a mistyped date would wake the thread on another day.
 */
function isOnTheCalendar([, year, month, day, hour, minute, second = "0"]: RegExpExecArray): boolean {
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= daysInMonth && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

function durationMs(text: string): number | null {
  const [, count = "0", unit = ""] = DURATION.exec(text.toLowerCase()) ?? [];
  return Number(count) === 0 || !isUnit(unit) ? null : Number(count) * UNIT_MS[unit];
}

/**
 * When a reminder that came due is next due, at `now` (null: it was a one-off). why the first
 * occurrence after now: a tick that missed several only wakes the thread once, and the rest keep
 * their times.
 */
export function nextDue({ dueAt, everyMs }: Pick<Reminder, "dueAt" | "everyMs">, now: number): number | null {
  if (everyMs === null) return null;
  return dueAt + (Math.floor((now - dueAt) / everyMs) + 1) * everyMs;
}

/** A repeat interval in its largest whole unit, such as "1d", "36h" or "90m". */
export function intervalText(everyMs: number): string {
  const unit = (["d", "h", "m"] as const).find((candidate) => everyMs % UNIT_MS[candidate] === 0) ?? "m";
  return `${everyMs / UNIT_MS[unit]}${unit}`;
}

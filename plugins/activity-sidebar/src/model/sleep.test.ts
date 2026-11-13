import assert from "node:assert/strict";
import { test } from "node:test";
import { customUntil, localInputValue, sleepPresets, tomorrowMorning, wakesIn } from "./sleep.ts";

// why: the presets are wall-clock times; New York has a DST change to test across.
process.env.TZ = "America/New_York";

const M = 60_000;
const H = 60 * M;
const at = (y: number, mo: number, d: number, h: number, mi = 0, sec = 0) => new Date(y, mo - 1, d, h, mi, sec).getTime();
const shown = (now: number) => sleepPresets(new Date(now)).map((p) => `${p.label} · ${p.when}`);

test("on a weekday afternoon every preset is ahead, soonest first, each saying when", () => {
  // Thursday 12 Nov 2026, 2:15 PM.
  const now = at(2026, 11, 12, 14, 15);
  assert.deepEqual(shown(now), [
    "In 1 hour · 3:15 PM",
    "In 3 hours · 5:15 PM",
    "This evening · 6:00 PM",
    "Tomorrow · 9:00 AM",
    "Next week · Mon 9:00 AM",
  ]);
  assert.deepEqual(
    sleepPresets(new Date(now)).map((p) => p.until),
    [now + H, now + 3 * H, at(2026, 11, 12, 18), at(2026, 11, 13, 9), at(2026, 11, 16, 9)],
  );
});

test("a time already past is dropped: no evening after 6 PM", () => {
  assert.deepEqual(shown(at(2026, 11, 12, 19, 30)), ["In 1 hour · 8:30 PM", "In 3 hours · 10:30 PM", "Tomorrow · 9:00 AM", "Next week · Mon 9:00 AM"]);
});

test("two presets on the same minute show once, the first kept", () => {
  // 3:00 PM: in three hours is 6:00 PM, the same minute as this evening.
  assert.deepEqual(shown(at(2026, 11, 12, 15)), ["In 1 hour · 4:00 PM", "In 3 hours · 6:00 PM", "Tomorrow · 9:00 AM", "Next week · Mon 9:00 AM"]);
});

test("an hour that crosses midnight names its day", () => {
  assert.deepEqual(shown(at(2026, 11, 12, 22, 30)).slice(0, 2), ["In 1 hour · 11:30 PM", "In 3 hours · Fri 1:30 AM"]);
});

test("next week is the coming Monday at 9; on a Monday, the one a week on", () => {
  const nextWeek = (now: number) => sleepPresets(new Date(now)).find((p) => p.label === "Next week")?.until;
  assert.equal(nextWeek(at(2026, 11, 16, 8)), at(2026, 11, 23, 9), "Monday morning, before 9");
  assert.equal(nextWeek(at(2026, 11, 16, 20)), at(2026, 11, 23, 9), "Monday evening");
  assert.equal(nextWeek(at(2026, 11, 14, 23, 59)), at(2026, 11, 16, 9), "Saturday night");
  // Sunday: tomorrow at 9 is next Monday at 9, one minute; Tomorrow sorts first and stays.
  assert.deepEqual(shown(at(2026, 11, 15, 20)), ["In 1 hour · 9:00 PM", "In 3 hours · 11:00 PM", "Tomorrow · 9:00 AM"]);
});

test("across a DST change the presets land on the wall-clock hour asked for", () => {
  // Saturday 31 Oct 2026, 8 PM EDT; clocks fall back at 2 AM on Sunday 1 Nov.
  const fallBack = sleepPresets(new Date(at(2026, 10, 31, 20)));
  const tomorrow = fallBack.find((p) => p.label === "Tomorrow");
  assert.equal(tomorrow?.when, "9:00 AM");
  assert.equal(tomorrow?.until, at(2026, 11, 1, 9));
  assert.equal(tomorrow.until - at(2026, 10, 31, 20), 14 * H, "13 wall-clock hours plus the hour given back");
  assert.equal(new Date(fallBack.find((p) => p.label === "Next week")?.until ?? 0).getHours(), 9);
  // Saturday 7 Mar 2026, 10 PM EST; clocks spring forward at 2 AM on Sunday 8 Mar.
  const springForward = sleepPresets(new Date(at(2026, 3, 7, 22)));
  const sunday = springForward.find((p) => p.label === "Tomorrow");
  assert.equal(sunday?.until, at(2026, 3, 8, 9));
  assert.equal(sunday.until - at(2026, 3, 7, 22), 10 * H, "11 wall-clock hours less the hour skipped");
  // "In 3 hours" is three real hours: 10 PM EST plus three is 1 AM, the hour 2-3 AM never happens.
  assert.equal(springForward.find((p) => p.label === "In 3 hours")?.when, "Sun 1:00 AM");
});

test("wakesIn rounds up: minutes under an hour, hours under a day, then days", () => {
  const cases: [number, string][] = [
    [0, "1m"],
    [1, "1m"],
    [45 * M, "45m"],
    [45 * M + 1, "46m"],
    [H, "1h"],
    [2 * H + 1, "3h"],
    [24 * H, "1d"],
    [36 * H, "2d"],
  ];
  for (const [left, text] of cases) assert.equal(wakesIn(1_000_000 + left, 1_000_000), text, `${left}ms`);
  assert.equal(wakesIn(0, 5 * M), "1m", "already due reads as a minute");
});

test("Custom… opens on tomorrow at 9 and accepts only a moment still ahead", () => {
  const now = at(2026, 11, 12, 14, 15, 30);
  assert.equal(localInputValue(tomorrowMorning(new Date(now))), "2026-11-13T09:00");
  assert.equal(customUntil("2026-11-13T09:00", now), at(2026, 11, 13, 9));
  assert.equal(customUntil("2026-11-12T14:16", now), at(2026, 11, 12, 14, 16));
  assert.equal(customUntil("2026-11-12T14:15", now), null, "this minute has begun");
  assert.equal(customUntil("2026-11-11T09:00", now), null, "yesterday");
  assert.equal(customUntil("", now), null, "nothing chosen");
});

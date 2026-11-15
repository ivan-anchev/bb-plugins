import assert from "node:assert/strict";
import { test } from "node:test";
import { backfill, record, spendDays, type Reading, type SpendHistory } from "./history.ts";

const at = (iso: string): number => Date.parse(iso);
const reading = (iso: string, monthDollars: number): Reading => ({ at: at(iso), monthDollars });

/** The history after these readings, in order, from nothing recorded. */
const recorded = (...readings: Reading[]): SpendHistory | null =>
  readings.reduce<SpendHistory | null>((history, next) => record(history, next), null);

/** The last `count` days as `day → dollars`, today being the last reading's day. */
function days(history: SpendHistory | null, today: string, count: number): Record<string, number | null> {
  return Object.fromEntries(spendDays(history, at(today), count).map(({ day, dollars }) => [day, dollars]));
}

test("the first reading ever only sets the baseline: what the month spent before it is unknown", () => {
  const history = recorded(reading("2026-11-14T09:00:00Z", 1.26));

  assert.deepEqual(days(history, "2026-11-14T09:00:00Z", 3), { "2026-11-12": null, "2026-11-13": null, "2026-11-14": 0 });
});

test("a first reading on the 1st counts the whole month so far, which started that day from zero", () => {
  const history = recorded(reading("2026-11-01T15:00:00Z", 0.4));

  assert.deepEqual(days(history, "2026-11-01T15:00:00Z", 1), { "2026-11-01": 0.4 });
});

test("readings on the same day add up what the meter grew by", () => {
  const history = recorded(
    reading("2026-11-14T09:00:00Z", 1),
    reading("2026-11-14T09:05:00Z", 1.25),
    reading("2026-11-14T09:10:00Z", 1.25),
    reading("2026-11-14T22:00:00Z", 2),
  );

  assert.deepEqual(days(history, "2026-11-14T22:00:00Z", 1), { "2026-11-14": 1 });
});

test("a gap of several days lands on the day it ends; the days inside it spent nothing that was seen", () => {
  const history = recorded(reading("2026-11-10T12:00:00Z", 1), reading("2026-11-13T08:00:00Z", 1.5));

  assert.deepEqual(days(history, "2026-11-13T08:00:00Z", 4), {
    "2026-11-10": 0,
    "2026-11-11": 0,
    "2026-11-12": 0,
    "2026-11-13": 0.5,
  });
});

test("a new month counts from zero, where boat restarts its meter", () => {
  const history = recorded(
    reading("2026-10-31T23:55:00Z", 40),
    reading("2026-11-01T00:00:00Z", 0.01),
    reading("2026-11-02T10:00:00Z", 0.5),
  );

  assert.deepEqual(days(history, "2026-11-02T10:00:00Z", 3), { "2026-10-31": 0, "2026-11-01": 0.01, "2026-11-02": 0.49 });
});

test("a month whose first reading comes days in counts it all on that day", () => {
  const history = recorded(reading("2026-10-30T12:00:00Z", 40), reading("2026-11-03T12:00:00Z", 2));

  assert.deepEqual(days(history, "2026-11-03T12:00:00Z", 1), { "2026-11-03": 2 });
});

test("a meter lower than the last reading makes no negative day, and the next growth counts from it", () => {
  const history = recorded(
    reading("2026-11-14T09:00:00Z", 5),
    reading("2026-11-14T09:05:00Z", 4.9),
    reading("2026-11-14T09:10:00Z", 5.2),
  );

  assert.equal(spendDays(history, at("2026-11-14T09:10:00Z"), 1)[0]?.dollars?.toFixed(2), "0.30");
});

test("a reading older than the last one, the server clock set back, changes nothing", () => {
  const history = recorded(reading("2026-11-14T09:00:00Z", 1), reading("2026-11-14T09:10:00Z", 2));

  assert.equal(record(history, reading("2026-11-14T09:05:00Z", 1.5)), history);
});

test("the chart's days end today, oldest first, and days long past are dropped from storage", () => {
  const history = recorded(reading("2026-09-01T12:00:00Z", 0), reading("2026-09-01T13:00:00Z", 3), reading("2026-11-14T09:00:00Z", 1));
  const chart = spendDays(history, at("2026-11-14T09:00:00Z"), 30);

  assert.equal(chart.length, 30);
  assert.equal(chart[0]?.day, "2026-10-16");
  assert.equal(chart.at(-1)?.day, "2026-11-14");
  assert.deepEqual(Object.keys(history?.days ?? {}), ["2026-11-14"]);
});

test("nothing recorded draws thirty unknown days", () => {
  assert.ok(spendDays(null, at("2026-11-14T09:00:00Z"), 30).every(({ dollars }) => dollars === null));
});

/** boat's dashboard days, oldest first: Nov 8–14 as the live account read them, Nov 13–14 bigger than recorded. */
const BOAT = [
  { day: "2026-11-08", dollars: 0.03 },
  { day: "2026-11-09", dollars: 0.3 },
  { day: "2026-11-10", dollars: 0.36 },
  { day: "2026-11-11", dollars: 0.21 },
  { day: "2026-11-12", dollars: 0.35 },
  { day: "2026-11-13", dollars: 9 },
  { day: "2026-11-14", dollars: 9 },
];
/** Recording began on the 13th; the 14th is today. */
const RECORDING = (): SpendHistory => recorded(reading("2026-11-13T09:00:00Z", 1), reading("2026-11-14T10:00:00Z", 1.25))!;
const NOW = "2026-11-14T12:00:00Z";

test("a backfill fills the unrecorded days inside the window with boat's numbers and leaves recorded days and today alone", () => {
  const { history, filled } = backfill(RECORDING(), BOAT, at(NOW), 5);

  assert.equal(filled, 3);
  assert.deepEqual(days(history, NOW, 5), {
    "2026-11-10": 0.36,
    "2026-11-11": 0.21,
    "2026-11-12": 0.35,
    "2026-11-13": 0,
    "2026-11-14": 0.25,
  });
});

test("a backfill writes no day outside the window", () => {
  const { history } = backfill(RECORDING(), BOAT, at(NOW), 5);

  assert.equal(history.days["2026-11-09"], undefined);
  assert.deepEqual(days(history, NOW, 6)["2026-11-09"], null);
});

test("a backfill stops at the first day boat has no number for, so the days before it stay unrecorded", () => {
  const withoutThe11th = BOAT.filter(({ day }) => day !== "2026-11-11");

  const { history, filled } = backfill(RECORDING(), withoutThe11th, at(NOW), 5);

  assert.equal(filled, 1);
  assert.deepEqual(days(history, NOW, 5), { "2026-11-10": null, "2026-11-11": null, "2026-11-12": 0.35, "2026-11-13": 0, "2026-11-14": 0.25 });
});

test("a repeated backfill fills nothing more", () => {
  const once = backfill(RECORDING(), BOAT, at(NOW), 5).history;

  const twice = backfill(once, BOAT, at(NOW), 5);

  assert.equal(twice.filled, 0);
  assert.deepEqual(twice.history, once);
});

test("a backfill never fills today, even when the clock is set back to before recording began", () => {
  const recording = recorded(reading("2026-11-14T00:30:00Z", 1))!;

  const { history, filled } = backfill(recording, BOAT, at("2026-11-13T23:30:00Z"), 5);

  assert.equal(filled, 0);
  assert.deepEqual(history, recording);
});

test("backfilled days stay through later readings and the month turning", () => {
  const filled = backfill(RECORDING(), BOAT, at(NOW), 5).history;

  const later = record(record(filled, reading("2026-11-30T23:00:00Z", 3)), reading("2026-12-01T01:00:00Z", 0.5));

  const chart = days(later, "2026-12-01T01:00:00Z", 23);
  assert.deepEqual([chart["2026-11-09"], chart["2026-11-10"], chart["2026-11-12"], chart["2026-11-14"], chart["2026-11-30"], chart["2026-12-01"]], [
    null,
    0.36,
    0.35,
    0.25,
    1.75,
    0.5,
  ]);
});

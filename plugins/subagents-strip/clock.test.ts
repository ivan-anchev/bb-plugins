import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClockTime, formatOffset } from "./clock.ts";

test("formatOffset reads m:ss under an hour and h:mm:ss past it, never negative", () => {
  assert.equal(formatOffset(0), "0:00");
  assert.equal(formatOffset(42_900), "0:42");
  assert.equal(formatOffset(252_000), "4:12");
  assert.equal(formatOffset(725_000), "12:05");
  assert.equal(formatOffset(3_725_000), "1:02:05");
  assert.equal(formatOffset(-5_000), "0:00"); // a step stamped a moment before its delegate
});

test("formatClockTime is the local time of day on a 24-hour clock, zero-padded", () => {
  // why: built from local fields, so the test holds in any time zone.
  assert.equal(formatClockTime(new Date(2026, 10, 5, 13, 58, 41).getTime()), "13:58");
  assert.equal(formatClockTime(new Date(2026, 10, 5, 9, 5).getTime()), "09:05");
  assert.equal(formatClockTime(new Date(2026, 10, 5, 0, 0).getTime()), "00:00");
});

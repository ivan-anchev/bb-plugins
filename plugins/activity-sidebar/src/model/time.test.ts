import assert from "node:assert/strict";
import { test } from "node:test";
import { ago } from "./time.ts";

const M = 60_000;

test("ago uses Zeron's short forms, floored", () => {
  const now = 100 * 7 * 24 * 60 * M;
  const cases: [number, string][] = [
    [0, "now"],
    [59_999, "now"],
    [M, "1m"],
    [59 * M + 59_999, "59m"],
    [60 * M, "1h"],
    [23 * 60 * M + 59 * M, "23h"],
    [24 * 60 * M, "1d"],
    [6 * 24 * 60 * M, "6d"],
    [7 * 24 * 60 * M, "1w"],
    [15 * 24 * 60 * M, "2w"],
  ];
  for (const [elapsed, text] of cases) assert.equal(ago(now - elapsed, now), text, `${elapsed}ms`);
});

test("a time after now reads as now", () => {
  assert.equal(ago(5 * M, 0), "now");
});

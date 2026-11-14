import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEKS, addDays, dailyTotals, gridStart, levelScale, weekday } from "./days.ts";

const thursday = new Date(2026, 10, 12, 0, 0, 0, 0).getTime(); // Thu, Nov 12 2026

test("the grid starts on a Monday and ends in today's week", () => {
  const start = gridStart(thursday);
  assert.equal(weekday(start), 0);
  assert.equal(addDays(start, (WEEKS - 1) * 7 + weekday(thursday)), thursday);
});

test("daily totals add PRs and lines per local day, zeros included", () => {
  const prs = [
    { mergedAt: thursday + 3_600_000, lines: 10 },
    { mergedAt: thursday + 7_200_000, lines: 5 },
    { mergedAt: addDays(thursday, -2) + 60_000, lines: 1 },
  ];
  const days = dailyTotals(prs, addDays(thursday, -2), thursday);
  assert.deepEqual(days.map((d) => [d.prs, d.lines]), [[1, 1], [0, 0], [2, 15]]);
});

test("levels split non-zero days by quartile, so one huge day keeps others visible", () => {
  const level = levelScale([0, 1, 1, 2, 3, 40]);
  assert.deepEqual([0, 1, 2, 3, 40].map(level), [0, 1, 2, 3, 4]);
  assert.equal(levelScale([0, 0])(5), 0);
});

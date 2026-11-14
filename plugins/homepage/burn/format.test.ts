import assert from "node:assert/strict";
import { test } from "node:test";
import { describeChange, formatMoney, formatTokens } from "./format.ts";

test("money: $0, cents under ten dollars, whole dollars with separators above", () => {
  assert.equal(formatMoney(0), "$0");
  assert.equal(formatMoney(0.004), "<$0.01");
  assert.equal(formatMoney(0.4), "$0.40");
  assert.equal(formatMoney(4.267), "$4.27");
  assert.equal(formatMoney(9.994), "$9.99");
  assert.equal(formatMoney(9.996), "$10");
  assert.equal(formatMoney(812.4), "$812");
  assert.equal(formatMoney(1800.2), "$1,800");
  assert.equal(formatMoney(2643.9), "$2,644");
  assert.equal(formatMoney(123456.7), "$123,457");
});

test("tokens: B with two decimals under 10B, one above", () => {
  assert.equal(formatTokens(5_130_000_000), "5.13B");
  assert.equal(formatTokens(1_990_000_000), "1.99B");
  assert.equal(formatTokens(7_191_000_000), "7.19B");
  assert.equal(formatTokens(9_994_000_000), "9.99B");
  assert.equal(formatTokens(9_995_000_000), "10.0B");
  assert.equal(formatTokens(12_340_000_000), "12.3B");
});

test("tokens: M with one decimal under 100M, whole above", () => {
  assert.equal(formatTokens(1_500_000), "1.5M");
  assert.equal(formatTokens(23_440_000), "23.4M");
  assert.equal(formatTokens(99_949_000), "99.9M");
  assert.equal(formatTokens(99_950_000), "100M");
  assert.equal(formatTokens(235_400_000), "235M");
});

test("tokens: K, and plain counts under a thousand", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_500), "1.5K");
  assert.equal(formatTokens(12_300), "12K");
  assert.equal(formatTokens(999_400), "999K");
});

test("tokens: rounding never writes 1000 of a unit", () => {
  assert.equal(formatTokens(999.6), "1.0K");
  assert.equal(formatTokens(999_600), "1.0M");
  assert.equal(formatTokens(999_600_000), "1.00B");
});

test("change: an increase is up, rounded, with the period in the long text", () => {
  assert.deepEqual(describeChange(1800, 800, "7d", "spend"), {
    direction: "up",
    short: "▲ 125%",
    full: "▲ 125% vs previous 7 days",
    spoken: "up 125% vs previous 7 days",
  });
  assert.equal(describeChange(5.13e9, 1.99e9, "7d", "tokens").short, "▲ 158%");
});

test("change: a decrease is down and names the month", () => {
  assert.deepEqual(describeChange(880, 1000, "30d", "spend"), {
    direction: "down",
    short: "▼ 12%",
    full: "▼ 12% vs previous 30 days",
    spoken: "down 12% vs previous 30 days",
  });
  assert.equal(describeChange(0, 50, "7d", "spend").short, "▼ 100%");
});

test("change: under half a percent either way is the same", () => {
  const same = describeChange(1004, 1000, "7d", "spend");
  assert.equal(same.direction, "same");
  assert.equal(same.short, "same");
  assert.equal(same.full, "Same as previous 7 days");
  assert.equal(describeChange(996, 1000, "7d", "spend").direction, "same");
});

test("change: nothing before is a dash, with spend and use worded apart", () => {
  const spend = describeChange(2644, 0, "30d", "spend");
  assert.equal(spend.direction, "none");
  assert.equal(spend.short, "—");
  assert.equal(spend.full, "No spend in the previous 30 days");
  assert.equal(spend.spoken, "No spend in the previous 30 days");
  assert.equal(describeChange(7.19e9, 0, "7d", "tokens").full, "No use in the previous 7 days");
  assert.equal(describeChange(0, 0, "7d", "spend").short, "—");
});

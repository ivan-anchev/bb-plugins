import assert from "node:assert/strict";
import { test } from "node:test";
import type { Billing } from "../boat/wire.ts";
import { balanceOf, costAt, dollarsPerHour } from "./money.ts";

// The live account's /limits on 2026-11-14: a $20 plan of 555.56 default-machine hours.
const PLAN: Billing = { walletDollars: 0, planHoursLeft: 520.52, renewsAt: Date.parse("2026-12-08T17:35:29Z"), vmHourDollars: 0.036 };

test("money left is the plan's hours left at the price past the plan, plus the wallet", () => {
  assert.deepEqual(balanceOf(PLAN), { kind: "left", dollars: 520.52 * 0.036 });
  assert.deepEqual(balanceOf({ ...PLAN, planHoursLeft: 0, walletDollars: 46.2 }), { kind: "left", dollars: 46.2 });
});

test("a wallet below zero shows what it owes", () => {
  assert.deepEqual(balanceOf({ ...PLAN, planHoursLeft: 0, walletDollars: -3.2 }), { kind: "owed", dollars: 3.2 });
});

test("a size's price an hour is its multiplier times a default machine's", () => {
  assert.deepEqual([0.5, 1, 2, 50 / 9].map((multiplier) => dollarsPerHour(multiplier, PLAN).toFixed(3)), ["0.018", "0.036", "0.072", "0.200"]);
});

test("a running boat's cost grows at its price an hour from the reading, never back from it", () => {
  const boat = { monthDollars: 0.05, dollarsPerHour: 0.072 };
  const readAt = Date.parse("2026-11-14T09:00:00Z");

  assert.equal(costAt(boat, readAt, readAt + 30 * 60_000).toFixed(3), "0.086");
  assert.equal(costAt(boat, readAt, readAt - 5_000), 0.05);
});

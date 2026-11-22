import { z } from "zod";
import type { Billing } from "../boat/wire.ts";

const HOUR_MS = 3_600_000;

/** What the account can still spend, or what its wallet owes. */
export const balance = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("left"), dollars: z.number() }),
  z.object({ kind: z.literal("owed"), dollars: z.number() }),
]);

type Balance = z.output<typeof balance>;

/** Plan time left at the price past the plan, plus the wallet; or, while the wallet is below zero, what it owes. */
export function balanceOf(billing: Billing): Balance {
  if (billing.walletDollars < 0) return { kind: "owed", dollars: -billing.walletDollars };
  return { kind: "left", dollars: Math.max(0, billing.planHoursLeft) * billing.vmHourDollars + billing.walletDollars };
}

/** A sandbox's price an hour: its rate against a `default` machine, at a `default` machine's price. */
export const dollarsPerHour = (billingMultiplier: number, billing: Billing): number => billingMultiplier * billing.vmHourDollars;

/** A running sandbox's month so far at `now`, from its meter read at `readAt`: it grows at its price an hour. */
export const costAt = (boat: { monthDollars: number; dollarsPerHour: number }, readAt: number, now: number): number =>
  boat.monthDollars + (boat.dollarsPerHour * Math.max(0, now - readAt)) / HOUR_MS;

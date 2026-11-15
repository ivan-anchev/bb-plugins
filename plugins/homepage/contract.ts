// Shared by server.ts and app.tsx: one read per homepage card.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const ACTIVITY_TAG = "activity";

const mergedPrSchema = z.object({ mergedAt: z.number(), lines: z.number() });
export type MergedPr = z.infer<typeof mergedPrSchema>;

const activitySchema = z.object({
  /** Your merged PRs in the window; null until GitHub has been read once. */
  prs: z.array(mergedPrSchema).nullable(),
  /** Start times of the threads you started in the window (not subagents or forks). */
  threadStarts: z.array(z.number()),
  /** Why GitHub could not be read, when there are no PRs to show instead. */
  problem: z.string().nullable(),
});
export type Activity = z.infer<typeof activitySchema>;

export const activityContract = defineRpcContract({
  /** The server's saved snapshot; it refreshes in the background and invalidates this tag. */
  activity: { input: z.object({}), output: activitySchema, tags: () => [ACTIVITY_TAG] },
});

/** Week and Month on the Burn card: Burn's rolling 7- and 30-day windows, not calendar ones. */
export const BURN_RANGES = ["7d", "30d"] as const;
export type BurnRange = (typeof BURN_RANGES)[number];

const amount = z.number().finite().nonnegative();
/** The four of Burn's `spend` numbers the card shows; `previous…` is the same length of time just before. */
export const burnTotalsSchema = z.object({ total: amount, previousTotal: amount, tokens: amount, previousTokens: amount });
export type BurnTotals = z.infer<typeof burnTotalsSchema>;

const burnSpendSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), ...burnTotalsSchema.shape }),
  /** Burn is missing, off, or its reply failed; `message` says which, in a line the card shows. */
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);
export type BurnSpend = z.infer<typeof burnSpendSchema>;

export const burnContract = defineRpcContract({
  /** Burn's spend and tokens over the range, read through Burn's own `spend` method on every call. */
  burnSpend: { input: z.object({ range: z.enum(BURN_RANGES) }), output: burnSpendSchema },
});

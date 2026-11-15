// What the app and the server share: the provider id and the RPC methods the chip, the sidebar and the homepage card call.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { launchChoices } from "./launch.ts";
import { spendDay } from "./spend/history.ts";
import { balance } from "./spend/money.ts";

/** The plugin's machine provider and environment composition id. */
export const PROVIDER_ID = "boat-sandbox";

/** The launch choices, or why boat Sandbox cannot launch until the settings change (no key, a refused key or account). */
const launchChoicesReply = z.discriminatedUnion("status", [
  launchChoices.extend({ status: z.literal("ready") }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type LaunchChoicesReply = z.output<typeof launchChoicesReply>;

/** One of this server's machine sandboxes that is up, by the thread it runs. */
const runningBoat = z.object({
  /** The key core made the machine with: for a composed create, the thread id. */
  threadId: z.string(),
  /** boat's machine size, for example `small`. */
  size: z.string(),
  /** Machine time this UTC month, at list price, as of `readAt`. */
  monthDollars: z.number(),
  dollarsPerHour: z.number(),
});

export type RunningBoat = z.output<typeof runningBoat>;

/** The homepage card, or the one line saying why there is none until the settings change (no key, a refused key or account). */
const spendCardReply = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    /** When boat was read (epoch ms); running costs grow from here. */
    readAt: z.number(),
    /** The last 30 UTC days of the wallet's machine time, oldest first, today last. */
    days: z.array(spendDay),
    /** Most expensive first. */
    running: z.array(runningBoat),
    balance,
    /** When the plan renews (epoch ms); null when boat names no date. */
    renewsAt: z.number().nullable(),
  }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type SpendCardReply = z.output<typeof spendCardReply>;

/** How many unrecorded days a backfill filled from boat's own daily numbers, or the one line saying why it couldn't. */
const backfillSpendReply = z.discriminatedUnion("status", [
  z.object({ status: z.literal("filled"), days: z.number().int() }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type BackfillSpendReply = z.output<typeof backfillSpendReply>;

// launchChoices is untagged: boat changes snapshots and environments out of band, so there is nothing to invalidate
// on; the chip reads again whenever its menu opens.
export const boatSandboxContract = defineRpcContract({
  launchChoices: {
    input: z.object({}),
    output: launchChoicesReply,
    experimental_description: "boat templates, environments and defaults for a new thread sandbox",
  },
  // Untagged: boat's meter moves by itself, so the card reads again every minute.
  spendCard: {
    input: z.object({}),
    output: spendCardReply,
    experimental_description: "boat machine spend for the last 30 days, the running boat sandboxes, and the money left",
  },
  // The card reads again once it answers.
  backfillSpend: {
    input: z.object({}),
    output: backfillSpendReply,
    experimental_description: "fill the boat spend chart's unrecorded days with boat's own daily machine spend",
  },
  // Keyed by bb host id. Untagged: a host's machine provider is fixed when bb creates it, so an answer never goes stale.
  boatHosts: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.boolean()),
    experimental_description: "whether each bb host is a boat sandbox machine",
  },
});

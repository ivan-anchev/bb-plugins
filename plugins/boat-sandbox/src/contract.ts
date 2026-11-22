import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { launchChoices } from "./launch.ts";
import { spendDay } from "./spend/history.ts";
import { balance } from "./spend/money.ts";

/** The plugin's machine provider and environment composition id. */
export const PROVIDER_ID = "boat-sandbox";

const launchChoicesReply = z.discriminatedUnion("status", [
  launchChoices.extend({ status: z.literal("ready") }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type LaunchChoicesReply = z.output<typeof launchChoicesReply>;

const runningBoat = z.object({
  threadId: z.string(),
  size: z.string(),
  monthDollars: z.number(),
  dollarsPerHour: z.number(),
});

export type RunningBoat = z.output<typeof runningBoat>;

const spendCardReply = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    readAt: z.number(),
    days: z.array(spendDay),
    running: z.array(runningBoat),
    balance,
    renewsAt: z.number().nullable(),
  }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type SpendCardReply = z.output<typeof spendCardReply>;

const backfillSpendReply = z.discriminatedUnion("status", [
  z.object({ status: z.literal("filled"), days: z.number().int() }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type BackfillSpendReply = z.output<typeof backfillSpendReply>;

const computerView = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-boat") }),
  z.object({ status: z.literal("starting") }),
  z.object({ status: z.literal("provisioning") }),
  z.object({ status: z.literal("ready"), url: z.url() }),
  z.object({ status: z.literal("stopped") }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type ComputerView = z.output<typeof computerView>;

export const boatSandboxContract = defineRpcContract({
  launchChoices: {
    input: z.object({}),
    output: launchChoicesReply,
    experimental_description: "boat templates, environments and defaults for a new thread sandbox",
  },
  spendCard: {
    input: z.object({}),
    output: spendCardReply,
    experimental_description: "boat machine spend for the last 30 days, the running boat sandboxes, and the money left",
  },
  backfillSpend: {
    input: z.object({}),
    output: backfillSpendReply,
    experimental_description: "fill the boat spend chart's unrecorded days with boat's own daily machine spend",
  },
  boatHosts: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.boolean()),
    experimental_description: "whether each bb host is a boat sandbox machine",
  },
  boatEnvironments: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.boolean()),
    experimental_description: "whether each bb environment runs on a boat sandbox machine",
  },
  computer: {
    input: z.object({ environmentId: z.string() }),
    output: computerView,
    experimental_description: "the boat sandbox desktop behind a bb environment, as a view-only noVNC page, or why there is none",
  },
});

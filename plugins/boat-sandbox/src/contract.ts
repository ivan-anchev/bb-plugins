// What the app and the server share: the provider id and the one RPC method the chip calls.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { launchChoices } from "./launch.ts";

/** The plugin's machine provider and environment composition id. */
export const PROVIDER_ID = "boat-sandbox";

/** The launch choices, or why boat Sandbox cannot launch until the settings change (no key, a refused key or account). */
const launchChoicesReply = z.discriminatedUnion("status", [
  launchChoices.extend({ status: z.literal("ready") }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export type LaunchChoicesReply = z.output<typeof launchChoicesReply>;

// Untagged: boat changes snapshots and environments out of band, so there is nothing to invalidate
// on; the chip reads again whenever its menu opens.
export const boatSandboxContract = defineRpcContract({
  launchChoices: {
    input: z.object({}),
    output: launchChoicesReply,
    experimental_description: "boat templates, environments and defaults for a new thread sandbox",
  },
});

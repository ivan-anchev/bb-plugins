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

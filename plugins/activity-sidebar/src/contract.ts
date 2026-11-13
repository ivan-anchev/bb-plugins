// The app <-> server contract and the one record it carries: a thread's sleep. Shared by server.ts and
// the app: pure zod plus defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * A thread put to sleep, keyed by thread id; `until` is epoch ms.
 *   until > now   asleep: on the Asleep shelf, its corner counting down
 *   until <= now  woke at `until`: back on the list, ranked by it, with the Woke glyph
 *   no record     awake
 * why: one field, so "asleep", "woke" and "woke at" can never disagree. "Woke" is never stored.
 */
export const sleepRecordSchema = z.object({
  threadId: z.string().min(1),
  until: z.number().int().nonnegative(),
});
export type SleepRecord = z.infer<typeof sleepRecordSchema>;

/** Every read of the sleeps carries it; every write invalidates it. */
export const SLEEPS_TAG = "sleeps";

export const activitySidebarContract = defineRpcContract({
  /** Every sleep record, for the whole list at once. */
  sleeps: {
    input: z.object({}),
    output: z.object({ sleeps: z.array(sleepRecordSchema) }),
    tags: () => [SLEEPS_TAG],
  },
  /** Sleep until a future time, wake now (`until` = now), or forget the record (null: opened after waking). */
  setSleep: {
    input: z.object({ threadId: z.string().min(1), until: z.number().int().nonnegative().nullable() }),
    output: z.object({}),
  },
});

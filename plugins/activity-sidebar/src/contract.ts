// The app <-> server contract and the records it carries: a thread's sleep, the Archived shelf's
// count, and the regional managers' looks and lines. Shared by server.ts and the app: pure zod plus defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { managerLineSchema } from "./model/manager-line.ts";
import { managerLookSchema } from "./model/manager-look.ts";

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

/**
 * How many archived parents the Archived shelf would list: in all, and per project id.
 * why: the shelf loads its rows in pages, so its folded count can't come from the rows it holds.
 */
const archivedCountSchema = z.object({
  total: z.number().int().nonnegative(),
  byProject: z.record(z.string(), z.number().int().positive()),
});
export type ArchivedCount = z.infer<typeof archivedCountSchema>;

/** Every read of the archived count carries it; a parent archived, unarchived or deleted invalidates it. */
export const ARCHIVED_COUNT_TAG = "archived-count";

/** Every read of the managers' looks carries it; a regional manager's thread created, renamed or archived, and every minute, invalidate it. */
export const MANAGER_LOOKS_TAG = "manager-looks";

/** Every read of the managers' lines carries it; a manager's line changing invalidates it. */
export const MANAGER_LINES_TAG = "manager-lines";

export const activitySidebarContract = defineRpcContract({
  /** Every sleep record, for the whole list at once. */
  sleeps: {
    input: z.object({}),
    output: z.object({ sleeps: z.array(sleepRecordSchema) }),
    tags: () => [SLEEPS_TAG],
  },
  /** The Archived shelf's true size, whatever of it has loaded. */
  archivedCount: {
    input: z.object({}),
    output: archivedCountSchema,
    tags: () => [ARCHIVED_COUNT_TAG],
  },
  /** Each open regional manager's avatar; none when the Regional Manager plugin can't be read. */
  managerLooks: {
    input: z.object({}),
    output: z.object({ looks: z.array(managerLookSchema) }),
    tags: () => [MANAGER_LOOKS_TAG],
  },
  /**
   * The line of each open regional manager among `threadIds` (the managers a client shows, so one
   * started or unarchived is read as it appears): the first sentence of its latest reply; a manager
   * with none has no entry.
   */
  managerLines: {
    input: z.object({ threadIds: z.array(z.string().min(1)).max(200) }),
    output: z.object({ lines: z.array(managerLineSchema) }),
    tags: () => [MANAGER_LINES_TAG],
  },
  /** Sleep until a future time, wake now (`until` = now), or forget the record (null: opened after waking). */
  setSleep: {
    input: z.object({ threadId: z.string().min(1), until: z.number().int().nonnegative().nullable() }),
    output: z.object({}),
  },
});

// The app <-> server contract and the records it carries. Shared by server.ts and the app: pure
// zod plus defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { boardStateSchema } from "./model/crew-state.ts";
import { memoryContentSchema, memoryFileSchema, memorySnapshotSchema, memoryVersionSchema, writeOutcomeSchema } from "./model/memory-file.ts";
import { coordinatorIdSchema, crewIdSchema, type CoordinatorId } from "./model/role.ts";

/** A coordinating thread: its memory is keyed by `id`, its conversation is `threadId`. */
export const coordinatorSchema = z.object({
  id: coordinatorIdSchema,
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type Coordinator = z.infer<typeof coordinatorSchema>;

/** Every read of the list carries it; a start or a bind invalidates it. */
export const COORDINATORS_TAG = "coordinators";

/** Every read of one coordinating thread's memory carries it; any write to its files invalidates it. */
export const memoryTag = (id: CoordinatorId): string => `memory:${id}`;
const memoryTags = ({ coordinatorId }: { coordinatorId: CoordinatorId }) => [memoryTag(coordinatorId)];

/** Every read of one coordinating thread's board carries it; a crew started or closed, or a crew thread's status change, invalidates it. */
export const boardTag = (id: CoordinatorId): string => `board:${id}`;

/** One crew on the board: where it sits, why, and its thread (null: it never got one) and branch (null: none yet). */
const boardRowSchema = z.object({
  crewId: crewIdSchema,
  title: z.string(),
  threadId: z.string().nullable(),
  branch: z.string().nullable(),
  state: boardStateSchema,
  headline: z.string(),
});
export type BoardRow = z.infer<typeof boardRowSchema>;

/** The board: DIGEST.md and when it last changed (null: there is none), then every crew in the order started. */
const boardSchema = z.object({
  digest: z.object({ content: z.string(), modifiedAt: z.number() }).nullable(),
  rows: z.array(boardRowSchema),
});
export type Board = z.infer<typeof boardSchema>;

// why only these fields are checked: the plugin reads only the project and the typed text, which
// becomes the goal. The rest goes to threads.spawn unchanged (as the composer asks), and bb
// validates it there.
const promptPartSchema = z.union([
  z.looseObject({ type: z.literal("text"), text: z.string() }),
  z.looseObject({ type: z.string().refine((type) => type !== "text") }),
]);
const newThreadRequestSchema = z.custom<NewThreadRequest>(
  (value) => z.looseObject({ projectId: z.string().min(1), input: z.array(promptPartSchema) }).safeParse(value).success,
  "Expected the composer's new-thread request",
);

export const coordinatorContract = defineRpcContract({
  /** Every coordinating thread whose thread exists, newest first. */
  coordinators: {
    input: z.object({}),
    output: z.object({ coordinators: z.array(coordinatorSchema) }),
    tags: () => [COORDINATORS_TAG],
  },
  /** The machine running bb, where the New page seeds a fresh worktree; null before one has joined. */
  primaryHost: {
    input: z.object({}),
    output: z.object({ hostId: z.string().nullable() }),
  },
  /** Starts a coordinating thread from bb's new-thread composer; the request's text is its goal. */
  startCoordinator: {
    input: z.object({ request: newThreadRequestSchema }),
    output: z.object({ threadId: z.string() }),
  },
  /** A coordinating thread's board. why the memory tag too: the board shows DIGEST.md. */
  board: {
    input: z.object({ coordinatorId: coordinatorIdSchema }),
    output: boardSchema,
    tags: ({ coordinatorId }) => [boardTag(coordinatorId), memoryTag(coordinatorId)],
  },
  /** A coordinating thread's memory folder on the bb server, and the files in it. */
  memoryList: {
    input: z.object({ coordinatorId: coordinatorIdSchema }),
    output: z.object({ dir: z.string(), files: z.array(memoryFileSchema) }),
    tags: memoryTags,
  },
  /** One memory file whole, with its version (null text: it doesn't exist), at its revision. */
  memoryRead: {
    input: z.object({ coordinatorId: coordinatorIdSchema, file: memoryFileSchema }),
    output: memorySnapshotSchema,
    tags: memoryTags,
  },
  /** Replaces a memory file if it is still `baseVersion`, as crew_memory_write does; else writes nothing. */
  memoryWrite: {
    input: z.object({ coordinatorId: coordinatorIdSchema, file: memoryFileSchema, content: memoryContentSchema, baseVersion: memoryVersionSchema }),
    output: writeOutcomeSchema,
  },
});

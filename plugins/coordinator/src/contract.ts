// The app <-> server contract and the records it carries. Shared by server.ts and the app: pure
// zod plus defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { coordinatorIdSchema } from "./model/role.ts";

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
});

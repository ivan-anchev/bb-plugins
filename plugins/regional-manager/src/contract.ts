// The app <-> server contract and the records it carries. Shared by server.ts and the app: pure
// zod plus defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { doneCriteriaSchema, environmentSchema, executionSchema } from "./model/crew.ts";
import { needsYouSchema } from "./model/board/board-groups.ts";
import { answerSchema, decisionIdSchema, decisionSchema } from "./model/decision.ts";
import { boardStateSchema } from "./model/board/crew-state.ts";
import { memoryContentSchema, memoryFileSchema, memorySnapshotSchema, memoryVersionSchema, writeOutcomeSchema } from "./model/memory-file.ts";
import { prSnapshotSchema } from "./model/verdict/pr.ts";
import { coordinatorIdSchema, crewIdSchema, type CoordinatorId } from "./model/role.ts";
import { verdictSchema } from "./model/verdict/verdict.ts";

/**
 * A coordinating thread: its memory is keyed by `id`, its conversation is `threadId`. `verify`:
 * whether its crews' done handoffs get a verifier from now on.
 */
export const coordinatorSchema = z.object({
  id: coordinatorIdSchema,
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  verify: z.boolean(),
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

/**
 * What a draft holds, to show and to seed its editor: its coordinating thread's project, the
 * environment its thread would get now and the model (null: the coordinating thread's).
 */
export const draftSchema = z.object({
  projectId: z.string(),
  brief: z.string(),
  doneCriteria: z.array(z.string()),
  execution: executionSchema.nullable(),
  environment: environmentSchema,
});
export type Draft = z.infer<typeof draftSchema>;

/**
 * One crew on the board: where it sits, why, its thread (null: it never got one) and branch (null:
 * none yet), the verdict of the done handoff that places it (null: none does), its pull request as
 * last read (null: none seen), and its draft (null: it is not one, or is closed).
 */
const boardRowSchema = z.object({
  crewId: crewIdSchema,
  title: z.string(),
  threadId: z.string().nullable(),
  branch: z.string().nullable(),
  state: boardStateSchema,
  headline: z.string(),
  verdict: verdictSchema.nullable(),
  pr: prSnapshotSchema.nullable(),
  draft: draftSchema.nullable(),
});
export type BoardRow = z.infer<typeof boardRowSchema>;

/**
 * The board: whether done handoffs are verified, how many files had changed in the coordinating
 * thread's own working tree when the turn that warned of them ended, and when (null: none, or it
 * was clean again since), why the latest read of a crew's pull request failed (null: none did),
 * DIGEST.md and when it last changed (null: there is none), every decision put to the user in the
 * order asked, then every crew in the order started.
 */
const boardSchema = z.object({
  verify: z.boolean(),
  ownEdits: z.object({ fileCount: z.number().int().min(1), at: z.number() }).nullable(),
  prUnavailable: z.string().nullable(),
  digest: z.object({ content: z.string(), modifiedAt: z.number() }).nullable(),
  decisions: z.array(decisionSchema),
  rows: z.array(boardRowSchema),
});
export type Board = z.infer<typeof boardSchema>;

// why only these fields are checked: the plugin reads only the project and the typed text, which
// becomes the goal or a draft's brief. The rest goes to threads.spawn unchanged (as the composer
// asks), and bb validates it there.
const promptPartSchema = z.union([
  z.looseObject({ type: z.literal("text"), text: z.string() }),
  z.looseObject({ type: z.string().refine((type) => type !== "text") }),
]);
const newThreadRequestSchema = z.custom<NewThreadRequest>(
  (value) => z.looseObject({ projectId: z.string().min(1), input: z.array(promptPartSchema) }).safeParse(value).success,
  "Expected the composer's new-thread request",
);

/** The text the user typed in bb's composer: every text part, in order. */
export const typedText = (request: NewThreadRequest): string =>
  request.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");

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
  /** Starts a coordinating thread from bb's new-thread composer; the request's text is its goal. `verify`: verify its crews' done handoffs. */
  startCoordinator: {
    input: z.object({ request: newThreadRequestSchema, verify: z.boolean() }),
    output: z.object({ threadId: z.string() }),
  },
  /** A coordinating thread's board. why the memory tag too: the board shows DIGEST.md. */
  board: {
    input: z.object({ coordinatorId: coordinatorIdSchema }),
    output: boardSchema,
    tags: ({ coordinatorId }) => [boardTag(coordinatorId), memoryTag(coordinatorId)],
  },
  /**
   * Replaces a draft's brief, model and environment with what bb's composer submitted, and its
   * done-criteria. Refused once the crew is starting, started or closed.
   */
  updateDraft: {
    input: z.object({
      coordinatorId: coordinatorIdSchema,
      crewId: crewIdSchema,
      request: newThreadRequestSchema
        .refine((request) => executionSchema.safeParse(request).success, "Expected the model bb's composer picked")
        .refine((request) => environmentSchema.safeParse(request.environment).success, "Expected an environment from bb's composer"),
      doneCriteria: doneCriteriaSchema,
    }),
    output: z.object({}),
  },
  /**
   * Turns verification of the coordinating thread's done handoffs on or off. It applies to handoffs
   * made after it; a handoff keeps the verdict it was made with. The only way to change it: no tool can.
   */
  setVerify: {
    input: z.object({ coordinatorId: coordinatorIdSchema, verify: z.boolean() }),
    output: z.object({}),
  },
  /** Stores the user's answer to a decision and wakes its coordinating thread. A decision is answered once: a second answer is refused. */
  answerDecision: {
    input: z.object({ coordinatorId: coordinatorIdSchema, decisionId: decisionIdSchema, answer: answerSchema }),
    output: z.object({}),
  },
  /**
   * What sits under Needs you on each of these coordinating threads' boards, counted from what its
   * board reads. Each one reads again when its board does.
   */
  needsYou: {
    input: z.object({ keys: z.array(coordinatorIdSchema) }),
    output: z.record(z.string(), needsYouSchema),
    keyTags: (key) => [boardTag(coordinatorIdSchema.parse(key))],
  },
  /** Spawns a draft's crew from what is stored. A second call while one runs joins it; one for a crew that is no longer a draft is refused. */
  startDraft: {
    input: z.object({ coordinatorId: coordinatorIdSchema, crewId: crewIdSchema }),
    output: z.object({ threadId: z.string() }),
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

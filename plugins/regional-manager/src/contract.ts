// The app <-> server contract and the records it carries. Shared by server.ts and the app: pure
// zod plus defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { agentIdSchema } from "./model/agent.ts";
import { needsYouSchema } from "./model/board/board-groups.ts";
import { answerSchema, decisionIdSchema, decisionSchema } from "./model/decision.ts";
import { issueIdSchema } from "./model/issue/issue.ts";
import { kindSchema } from "./model/issue/kind.ts";
import { issueStatusSchema } from "./model/issue/status.ts";
import { memoryContentSchema, memoryFileSchema, memorySnapshotSchema, memoryVersionSchema, writeOutcomeSchema } from "./model/memory-file.ts";
import { prSnapshotSchema } from "./model/verdict/pr.ts";
import { coordinatorIdSchema, type CoordinatorId } from "./model/role.ts";
import { verdictSchema } from "./model/verdict/verdict.ts";

/**
 * A regional manager: its memory is keyed by `id`, its conversation is `threadId`. `verify`:
 * whether its agents' done handoffs get a verifier from now on.
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

/** Every read of one regional manager's memory carries it; any write to its files invalidates it. */
export const memoryTag = (id: CoordinatorId): string => `memory:${id}`;
const memoryTags = ({ coordinatorId }: { coordinatorId: CoordinatorId }) => [memoryTag(coordinatorId)];

/** Every read of one regional manager's board carries it; an issue filed or changed, an agent started or ended, or an agent's thread changing status, invalidates it. */
export const boardTag = (id: CoordinatorId): string => `board:${id}`;

/**
 * One issue on the board, as its view reads now: its kind, its status, why it waits on the user
 * (null: it doesn't; the board then shows it under Needs you, its status on the row), its latest
 * agent (null: none started) with that agent's thread while bb runs it (null: archived or deleted),
 * its branch (null: none on record; an earlier agent's when the latest has none), the check that
 * places it, as the row shows it (null: none does), and its pull request as last read (null: none
 * seen).
 */
const issueRowSchema = z.object({
  id: issueIdSchema,
  kind: kindSchema,
  title: z.string(),
  status: issueStatusSchema,
  needsYou: z.string().nullable(),
  headline: z.string(),
  agent: z.object({ id: agentIdSchema, threadId: z.string().nullable() }).nullable(),
  branch: z.string().nullable(),
  placing: z.object({ verdict: verdictSchema }).nullable(),
  pr: prSnapshotSchema.nullable(),
});
export type IssueRow = z.infer<typeof issueRowSchema>;

/**
 * The board: whether done handoffs are verified, how many files had changed in the coordinating
 * thread's own working tree when the turn that warned of them ended, and when (null: none, or it
 * was clean again since), why the latest read of an issue's pull request failed (null: none did),
 * DIGEST.md and when it last changed (null: there is none), every decision put to the user in the
 * order asked, then every issue in the order filed.
 */
const boardSchema = z.object({
  verify: z.boolean(),
  ownEdits: z.object({ fileCount: z.number().int().min(1), at: z.number() }).nullable(),
  prUnavailable: z.string().nullable(),
  digest: z.object({ content: z.string(), modifiedAt: z.number() }).nullable(),
  decisions: z.array(decisionSchema),
  issues: z.array(issueRowSchema),
});
export type Board = z.infer<typeof boardSchema>;

// why only these fields are checked: the plugin reads only the project and the typed text, which
// becomes the goal. The rest goes to threads.spawn unchanged (as the composer
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
  /** Every regional manager whose thread exists, newest first. */
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
  /** Starts a regional manager from bb's new-thread composer; the request's text is its goal. `verify`: verify its agents' done handoffs. */
  startCoordinator: {
    input: z.object({ request: newThreadRequestSchema, verify: z.boolean() }),
    output: z.object({ threadId: z.string() }),
  },
  /** A regional manager's board. why the memory tag too: the board shows DIGEST.md. */
  board: {
    input: z.object({ coordinatorId: coordinatorIdSchema }),
    output: boardSchema,
    tags: ({ coordinatorId }) => [boardTag(coordinatorId), memoryTag(coordinatorId)],
  },
  /**
   * Turns verification of the regional manager's done handoffs on or off. It applies to handoffs
   * made after it; a handoff keeps the verdict it was made with. The only way to change it: no tool can.
   */
  setVerify: {
    input: z.object({ coordinatorId: coordinatorIdSchema, verify: z.boolean() }),
    output: z.object({}),
  },
  /** Stores the user's answer to a decision and wakes its regional manager. A decision is answered once: a second answer is refused. */
  answerDecision: {
    input: z.object({ coordinatorId: coordinatorIdSchema, decisionId: decisionIdSchema, answer: answerSchema }),
    output: z.object({}),
  },
  /**
   * What sits under Needs you on each of these regional managers' boards, counted from what its
   * board reads. Each one reads again when its board does.
   */
  needsYou: {
    input: z.object({ keys: z.array(coordinatorIdSchema) }),
    output: z.record(z.string(), needsYouSchema),
    keyTags: (key) => [boardTag(coordinatorIdSchema.parse(key))],
  },
  /** A regional manager's memory folder on the bb server, and the files in it. */
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

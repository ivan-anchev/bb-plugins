// The app <-> server contract and the records it carries. Shared by server.ts and the app: pure
// zod plus defineRpcContract.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { agentIdSchema } from "./model/agent/agent.ts";
import { needsYouSchema } from "./model/board/board-groups.ts";
import { answerSchema, decisionIdSchema, decisionSchema } from "./model/decision.ts";
import { executionSchema } from "./model/agent/execution.ts";
import { commentIdSchema, commentTextSchema } from "./model/feed/comment.ts";
import { entrySchema } from "./model/feed/entry.ts";
import { roundBodySchema, roundKeySchema, type RoundKey } from "./model/feed/round.ts";
import { descriptionSchema, doneCriteriaSchema, issueIdSchema, type IssueId } from "./model/issue/issue.ts";
import { kindSchema } from "./model/issue/kind.ts";
import { issueStatusSchema } from "./model/issue/status.ts";
import { memoryContentSchema, memoryFileSchema, memorySnapshotSchema, memoryVersionSchema, writeOutcomeSchema } from "./model/memory-file.ts";
import { prSnapshotSchema } from "./model/verdict/pr.ts";
import { newProfileSchema, profileSchema } from "./model/profile/profile.ts";
import { coordinatorIdSchema, type CoordinatorId } from "./model/role.ts";

/**
 * A started regional manager: its memory is keyed by `id`, its conversation is `threadId`, which
 * works on `projectId`. Its profile without its name, which is its thread's title (profile.ts).
 */
export const coordinatorSchema = z.object({
  id: coordinatorIdSchema,
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  description: profileSchema.shape.description,
  avatar: profileSchema.shape.avatar,
});
export type Coordinator = z.infer<typeof coordinatorSchema>;

/**
 * A regional manager not started yet: created on the New page with its profile and no thread, which
 * the goal sent from its page starts, titled with `name`.
 */
export const notStartedSchema = profileSchema.extend({ id: coordinatorIdSchema });
export type NotStarted = z.infer<typeof notStartedSchema>;

/** Every read of the list carries it; a create, a start, a bind, a delete or a profile edit invalidates it. */
export const COORDINATORS_TAG = "coordinators";

/** Every read of one regional manager's memory carries it; any write to its files invalidates it. */
export const memoryTag = (id: CoordinatorId): string => `memory:${id}`;
const memoryTags = ({ coordinatorId }: { coordinatorId: CoordinatorId }) => [memoryTag(coordinatorId)];

/** Every read of one regional manager's board carries it; an issue filed or changed, an agent started or ended, or an agent's thread changing status, invalidates it. */
export const boardTag = (id: CoordinatorId): string => `board:${id}`;

/** An agent as the board names it, with the thread it opens (null: none to open). */
const shownAgentSchema = z.object({ id: agentIdSchema, threadId: z.string().nullable() });

/** Every read of one issue's feed or of its rounds' bodies carries it; a write counted for the issue (issue-tags.ts) invalidates it. */
export const issueTag = (coordinatorId: CoordinatorId, issueId: IssueId): string => `issue:${coordinatorId}/${issueId}`;

/**
 * An issue in its tab, beyond its board row (which the tab reads with the board): what it is about,
 * its done-criteria, what it depends on and what depends on it, every agent that held it with its
 * thread while bb still has it (null: none to open), and its feed, oldest first (entry.ts).
 */
const issueFeedSchema = z.object({
  description: descriptionSchema,
  doneCriteria: doneCriteriaSchema,
  dependsOn: z.array(issueIdSchema),
  blocks: z.array(issueIdSchema),
  agents: z.array(shownAgentSchema),
  entries: z.array(entrySchema),
});
export type IssueFeed = z.infer<typeof issueFeedSchema>;

/** A round's address for roundBodies: its regional manager, its issue and its round. why one string: a keyed read is keyed by strings. */
export const roundBodyKey = (coordinatorId: CoordinatorId, issueId: IssueId, round: RoundKey): string => `${coordinatorId}/${issueId}/${round}`;
const roundBodyKeySchema = z
  .string()
  .transform((key) => key.split("/"))
  .pipe(z.tuple([coordinatorIdSchema, issueIdSchema, roundKeySchema]))
  .transform(([coordinatorId, issueId, round]) => ({ coordinatorId, issueId, round }));
/** The round a roundBodies key names; null for a key no roundBodyKey made. */
export const parseRoundBodyKey = (key: string) => roundBodyKeySchema.safeParse(key).data ?? null;

/**
 * One issue on the board, as its view reads now: its kind, its parent (null: none), how many of its
 * sub-issues are Done of how many (null: it has none), the open issues it or its parent depends on
 * (none: nothing blocks it), the open issues that depend on it while it is open itself (none: it
 * blocks nothing), its status, why it waits on the user (null: it doesn't; the board then shows
 * it under Needs you, with this reason under its title), its latest agent
 * (null: none started) with that agent's thread while bb runs it (null: archived or deleted), and
 * its pull request as last read (null: none seen). Its rounds are in its feed (`issueFeed`).
 */
const issueRowSchema = z.object({
  id: issueIdSchema,
  kind: kindSchema,
  parentId: issueIdSchema.nullable(),
  subIssues: z.object({ done: z.number().int().nonnegative(), total: z.number().int().positive() }).nullable(),
  blockedBy: z.array(issueIdSchema),
  blocks: z.array(issueIdSchema),
  title: z.string(),
  status: issueStatusSchema,
  needsYou: z.string().nullable(),
  headline: z.string().nullable(),
  agent: shownAgentSchema.nullable(),
  pr: prSnapshotSchema.nullable(),
});
export type IssueRow = z.infer<typeof issueRowSchema>;

/**
 * The board: whether done handoffs are verified, how many files had changed in the coordinating
 * thread's own working tree when the turn that warned of them ended, and when (null: none, or it
 * was clean again since), why the latest read of an issue's pull request failed (null: none did),
 * every decision put to the user in the order asked, then every issue in the order filed. The board
 * draws only the open decisions; the answered ones are carried so the browser drops what was typed to
 * them, and each stays among its issue's decisions in the issue's feed.
 */
const boardSchema = z.object({
  verify: z.boolean(),
  ownEdits: z.object({ fileCount: z.number().int().min(1), at: z.number() }).nullable(),
  prUnavailable: z.string().nullable(),
  decisions: z.array(decisionSchema),
  issues: z.array(issueRowSchema),
});
export type Board = z.infer<typeof boardSchema>;

type ComposedPart = NewThreadRequest["input"][number];
// why only a part's type, and a text part's text, checked: bb validates the rest at the spawn, and the plugin reads nothing else of it.
const composedPartSchema = z.custom<ComposedPart>(
  (value) => z.union([z.looseObject({ type: z.literal("text"), text: z.string() }), z.looseObject({ type: z.string().refine((type) => type !== "text") })]).safeParse(value).success,
  "Expected a part of the composer's message",
);

/**
 * What bb's new-thread composer submits that starts a regional manager: the project, what it runs on,
 * where (bb validates the environment at the spawn), and the message, whose text is its goal. Only
 * these fields reach the spawn: any other is dropped, as is `executionInputSources`, so bb counts
 * every execution field as chosen and runs exactly what the composer showed.
 */
const composerRequestSchema = executionSchema.extend({
  projectId: z.string().min(1),
  permissionMode: z.enum(["accept-edits", "auto", "full"]),
  serviceTier: z.string().optional(),
  sessionOptions: z.custom<NonNullable<NewThreadRequest["sessionOptions"]>>((value) => z.record(z.string(), z.unknown()).safeParse(value).success).optional(),
  environment: z.custom<NewThreadRequest["environment"]>((value) => z.looseObject({ type: z.string() }).safeParse(value).success, "Expected where the thread runs"),
  input: z.array(composedPartSchema).refine((parts) => parts.some((part) => part.type === "text" && part.text.trim() !== ""), "A goal needs text"),
  sendAt: z.number().optional(),
});
export type ComposerRequest = z.infer<typeof composerRequestSchema>;

/** The text the user typed in bb's composer: every text part, in order. */
export const typedText = ({ input }: Pick<ComposerRequest, "input">): string => input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");

/** A memory file as the board's Memory lists it: its name, the start of its text (model/memory-file.ts `previewOf`) and when it last changed, in epoch ms. */
const memoryEntrySchema = z.object({ file: memoryFileSchema, preview: z.string(), modifiedAt: z.number() });
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const coordinatorContract = defineRpcContract({
  /** Every regional manager whose thread exists, and every one not started yet, each newest first. */
  coordinators: {
    input: z.object({}),
    output: z.object({ coordinators: z.array(coordinatorSchema), notStarted: z.array(notStartedSchema) }),
    tags: () => [COORDINATORS_TAG],
  },
  /** The machine running bb, which a new thread's worktree is made on (null before one has joined). */
  primaryHost: {
    input: z.object({}),
    output: z.object({ hostId: z.string().nullable() }),
  },
  /**
   * Creates a regional manager with this profile and no thread: its goal, sent from its page, starts
   * it (startCoordinator). An `auto` avatar is picked as it is saved, a look no other manager has while one is free.
   */
  createCoordinator: {
    input: z.object({ profile: newProfileSchema }),
    output: z.object({ coordinatorId: coordinatorIdSchema }),
  },
  /**
   * Starts a regional manager from bb's composer on its page: spawns its thread, titled with its
   * name, on what the composer picked, with the request's text as its first message and its GOAL.md.
   * Idempotent: a regional manager already started answers with its thread, and spawns nothing.
   */
  startCoordinator: {
    input: z.object({ coordinatorId: coordinatorIdSchema, request: composerRequestSchema }),
    output: z.object({ threadId: z.string() }),
  },
  /** Replaces a regional manager's profile: retitles its thread with the name once it has one, and keeps the rest. */
  setProfile: {
    input: z.object({ coordinatorId: coordinatorIdSchema, profile: profileSchema }),
    output: z.object({}),
  },
  /** Deletes a regional manager not started yet. One with a thread is refused: archiving or deleting its thread in bb removes it. */
  deleteCoordinator: {
    input: z.object({ coordinatorId: coordinatorIdSchema }),
    output: z.object({}),
  },
  /** A regional manager's board. */
  board: {
    input: z.object({ coordinatorId: coordinatorIdSchema }),
    output: boardSchema,
    tags: ({ coordinatorId }) => [boardTag(coordinatorId)],
  },
  /** One issue's feed, read again whenever that issue's facts change, and only then. */
  issueFeed: {
    input: z.object({ coordinatorId: coordinatorIdSchema, issueId: issueIdSchema }),
    output: issueFeedSchema,
    tags: ({ coordinatorId, issueId }) => [issueTag(coordinatorId, issueId)],
  },
  /** The bodies of the rounds a reader opened, each read alone and again when its issue changes; null for a key that names no round. */
  roundBodies: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), roundBodySchema.nullable()),
    keyTags: (key) => {
      const named = parseRoundBodyKey(key);
      return named === null ? [] : [issueTag(named.coordinatorId, named.issueId)];
    },
  },
  /**
   * Posts the user's comment on an issue, from its tab, answering `replyTo`, a comment of the same
   * issue (null: none), and wakes its regional manager, whose every comment of theirs it is: it
   * replies, records a decision, or tells the issue's agent.
   */
  commentIssue: {
    input: z.object({ coordinatorId: coordinatorIdSchema, issueId: issueIdSchema, text: commentTextSchema, replyTo: commentIdSchema.nullable() }),
    output: z.object({ commentId: commentIdSchema }),
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
  /** The files in a regional manager's memory folder on the bb server, in the folder's order. */
  memoryList: {
    input: z.object({ coordinatorId: coordinatorIdSchema }),
    output: z.object({ files: z.array(memoryEntrySchema) }),
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

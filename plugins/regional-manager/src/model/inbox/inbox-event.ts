// What the plugin tells a regional manager about: every fact it observes about its issues, agents and
// memory, the reminders it set itself and the user's answers to its decisions, stored whole.
// Agent-written text (an answer, an error, a question) lives only here and in crew_catch_up, never in
// the doorbell that announces it; so does the user's answer to a decision, kept with the decision.
import { z } from "zod";
import { agentIdSchema, endedHowSchema } from "../agent.ts";
import { decisionIdSchema } from "../decision.ts";
import { handoffIdSchema, handoffStatusSchema } from "../handoff.ts";
import { issueIdSchema } from "../issue/issue.ts";
import { issueStatusSchema } from "../issue/status.ts";
import { memoryFileSchema } from "../memory-file.ts";
import { reminderIdSchema, reminderNoteSchema } from "../reminder.ts";
import { checkIdSchema } from "../verdict/check.ts";
import { prChangeSchema, prSnapshotSchema } from "../verdict/pr.ts";

/** What the plugin tells a regional manager about itself, its memory, its reminders and its decisions: no issue or agent in them. */
const managerEvents = [
  /** The user turned verification of done handoffs on or off on the board. */
  z.object({ kind: z.literal("verification-toggled"), verify: z.boolean() }),
  /** The user saved a memory file in the Memory editor. */
  z.object({ kind: z.literal("memory-edited"), file: memoryFileSchema }),
  /** A reminder the coordinating thread set came due at `dueAt`; `everyMs` is how often it repeats (null: it was a one-off, and is gone). */
  z.object({ kind: z.literal("reminder"), reminderId: reminderIdSchema, note: reminderNoteSchema, dueAt: z.number(), everyMs: z.number().int().positive().nullable() }),
  /** The user answered a decision the coordinating thread put to them with crew_ask_user. */
  z.object({ kind: z.literal("decision-answered"), decisionId: decisionIdSchema }),
  /**
   * A turn of the coordinating thread ended with changed files in its own checkout, other than the
   * last read found. why no fields: what it says is the latest read (own-tree.ts), which an unread
   * one always matches, as a newer read retires it (see recordOwnTree).
   */
  z.object({ kind: z.literal("coordinator-tree-changed") }),
] as const;

const onAgent = { issueId: issueIdSchema, agentId: agentIdSchema };

/**
 * What the plugin tells a regional manager about its issues and agents. Every event about work
 * names its issue; one about a thread names the agent too; one about a verdict names the check.
 */
export const inboxEventSchema = z.discriminatedUnion("kind", [
  /** An agent's handoff no verifier checks, announced at once: blocked, gave up, or done on an issue nothing verifies. A done one a verifier checks is announced as `checked`, with its verdict. */
  z.object({ kind: z.literal("handoff"), ...onAgent, handoffId: handoffIdSchema, status: handoffStatusSchema }),
  /** A check is final and nothing goes back to its agent, or verification was off. */
  z.object({ kind: z.literal("checked"), issueId: issueIdSchema, checkId: checkIdSchema }),
  /** A check failed, and the plugin sent its findings back to the agent as its fix round `round`. */
  z.object({ kind: z.literal("sent-back"), ...onAgent, checkId: checkIdSchema, round: z.number().int().min(1) }),
  /** An agent's turn ended with no current handoff; `lastAnswer` is its last answer, whole (null: none). */
  z.object({ kind: z.literal("idle-without-handoff"), ...onAgent, lastAnswer: z.string().nullable() }),
  /** An agent's thread failed; `error` is bb's message for it (null: none). */
  z.object({ kind: z.literal("failed"), ...onAgent, error: z.string().nullable() }),
  /** An agent waits on the user's answer or approval in its thread; `question` says what it asks. */
  z.object({ kind: z.literal("needs-input"), ...onAgent, question: z.string() }),
  /** The pull request of the agent's branch changed meaningfully (see meaningfulChanges): what changed, and the pull request as read then. */
  z.object({ kind: z.literal("pr"), ...onAgent, pr: prSnapshotSchema, changes: z.array(prChangeSchema).min(1) }),
  /** The issue's agent ended before its work reached Verifying, In review or Done, so the issue rests in Todo again. */
  z.object({ kind: z.literal("returned-to-todo"), ...onAgent, how: endedHowSchema.exclude(["spawn-failed", "replaced"]) }),
  /** The issue `by`, the last of its dependencies still open, closed without the manager closing it (a merge, a report), and stands `closedAs` (relations.ts unblockedSince). */
  z.object({ kind: z.literal("unblocked"), issueId: issueIdSchema, by: issueIdSchema, closedAs: issueStatusSchema.extract(["done", "canceled"]) }),
  ...managerEvents,
]);
export type InboxEvent = z.infer<typeof inboxEventSchema>;

/** An event as stored: numbered in the order it was recorded, at the time it was. */
export type StoredEvent = { id: number; at: number; event: InboxEvent };

/**
 * Whether an event of each kind wakes its coordinating thread on its own. One that doesn't waits,
 * unannounced, for the next one that does, and is listed in that doorbell and in the catch-up. why
 * `sent-back` doesn't: it leaves the thread nothing to do, and a turn costs tokens and context. why
 * `coordinator-tree-changed` does: only the thread can tell whether the user asked for the change
 * and hand it to an agent if not, and with no agent at work nothing else may wake it for hours. It
 * can't wake the thread in a loop: the turn it starts ends with the same files, which records nothing.
 */
const WAKES: Record<InboxEvent["kind"], boolean> = {
  handoff: true,
  checked: true,
  "sent-back": false,
  "idle-without-handoff": true,
  failed: true,
  "needs-input": true,
  pr: true,
  // why: only the regional manager can plan the issue again.
  "returned-to-todo": true,
  // why: only the regional manager starts its agent.
  unblocked: true,
  "verification-toggled": true,
  "memory-edited": true,
  reminder: true,
  "decision-answered": true,
  "coordinator-tree-changed": true,
};

export const wakes = (event: InboxEvent): boolean => WAKES[event.kind];

/**
 * Whether the doorbell shows the event to the user. why a changed checkout isn't: the user asked for
 * a manager that puts its own slip right without involving them.
 */
export const shownToUser = (event: InboxEvent): boolean => event.kind !== "coordinator-tree-changed";

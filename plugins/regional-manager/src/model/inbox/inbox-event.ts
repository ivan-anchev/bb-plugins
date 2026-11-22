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

const managerEvents = [
  z.object({ kind: z.literal("verification-toggled"), verify: z.boolean() }),
  z.object({ kind: z.literal("memory-edited"), file: memoryFileSchema }),
  z.object({ kind: z.literal("reminder"), reminderId: reminderIdSchema, note: reminderNoteSchema, dueAt: z.number(), everyMs: z.number().int().positive().nullable() }),
  z.object({ kind: z.literal("decision-answered"), decisionId: decisionIdSchema }),
  z.object({ kind: z.literal("coordinator-edited-files"), fileCount: z.number().int().min(1) }),
  z.object({ kind: z.literal("coordinator-tree-clean") }),
] as const;

const onAgent = { issueId: issueIdSchema, agentId: agentIdSchema };

/**
 * What the plugin tells a regional manager about its issues and agents. Every event about work
 * names its issue; one about a thread names the agent too; one about a verdict names the check.
 */
export const inboxEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("handoff"), ...onAgent, handoffId: handoffIdSchema, status: handoffStatusSchema }),
  z.object({ kind: z.literal("checked"), issueId: issueIdSchema, checkId: checkIdSchema }),
  z.object({ kind: z.literal("sent-back"), ...onAgent, checkId: checkIdSchema, round: z.number().int().min(1) }),
  z.object({ kind: z.literal("idle-without-handoff"), ...onAgent, lastAnswer: z.string().nullable() }),
  z.object({ kind: z.literal("failed"), ...onAgent, error: z.string().nullable() }),
  z.object({ kind: z.literal("needs-input"), ...onAgent, question: z.string() }),
  z.object({ kind: z.literal("pr"), ...onAgent, pr: prSnapshotSchema, changes: z.array(prChangeSchema).min(1) }),
  z.object({ kind: z.literal("returned-to-todo"), ...onAgent, how: endedHowSchema.exclude(["spawn-failed", "replaced"]) }),
  z.object({ kind: z.literal("unblocked"), issueId: issueIdSchema, by: issueIdSchema, closedAs: issueStatusSchema.extract(["done", "canceled"]) }),
  ...managerEvents,
]);
export type InboxEvent = z.infer<typeof inboxEventSchema>;

/** An event as stored: numbered in the order it was recorded, at the time it was. */
export type StoredEvent = { id: number; at: number; event: InboxEvent };

const WAKES: Record<InboxEvent["kind"], boolean> = {
  handoff: true,
  checked: true,
  "sent-back": false,
  "idle-without-handoff": true,
  failed: true,
  "needs-input": true,
  pr: true,
  "returned-to-todo": true,
  unblocked: true,
  "verification-toggled": true,
  "memory-edited": true,
  reminder: true,
  "decision-answered": true,
  "coordinator-edited-files": true,
  "coordinator-tree-clean": false,
};

export const wakes = (event: InboxEvent): boolean => WAKES[event.kind];

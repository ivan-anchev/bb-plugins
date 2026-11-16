// What the plugin tells a coordinating thread about: every fact it observes about the crews and the
// memory, and the reminders it set itself, stored whole. Crew-written text (an answer, an error, a question) lives only here and in
// crew_catch_up, never in the doorbell that announces it.
import { z } from "zod";
import { handoffIdSchema, handoffStatusSchema } from "../handoff.ts";
import { memoryFileSchema } from "../memory-file.ts";
import { reminderIdSchema, reminderNoteSchema } from "../reminder.ts";
import { prChangeSchema, prSnapshotSchema } from "../verdict/pr.ts";
import { crewIdSchema } from "../role.ts";

export const inboxEventSchema = z.discriminatedUnion("kind", [
  /**
   * A crew called crew_handoff. A done one is announced here only if it was handed off before
   * verification existed; since then a done handoff is announced as `checked`.
   */
  z.object({ kind: z.literal("handoff"), crewId: crewIdSchema, handoffId: handoffIdSchema, status: handoffStatusSchema }),
  /**
   * A crew's done handoff and its verdict, together: once the verdict is final and nothing goes back
   * to the crew, or at once when verification was off.
   */
  z.object({ kind: z.literal("checked"), crewId: crewIdSchema, handoffId: handoffIdSchema }),
  /** A crew's done handoff failed its verdict, and the plugin sent the findings back to the crew as its fix round `round`. */
  z.object({ kind: z.literal("sent-back"), crewId: crewIdSchema, handoffId: handoffIdSchema, round: z.number().int().min(1) }),
  /** A crew's turn ended with no current handoff; `lastAnswer` is its last answer, whole (null: none). */
  z.object({ kind: z.literal("idle-without-handoff"), crewId: crewIdSchema, lastAnswer: z.string().nullable() }),
  /** A crew's thread failed; `error` is bb's message for it (null: none). */
  z.object({ kind: z.literal("failed"), crewId: crewIdSchema, error: z.string().nullable() }),
  /** A crew waits on the user's answer or approval in its thread; `question` says what it asks. */
  z.object({ kind: z.literal("needs-input"), crewId: crewIdSchema, question: z.string() }),
  /** A crew's pull request changed meaningfully (see meaningfulChanges): what changed, and the pull request as read then. */
  z.object({ kind: z.literal("pr"), crewId: crewIdSchema, pr: prSnapshotSchema, changes: z.array(prChangeSchema).min(1) }),
  /** The user turned verification of done handoffs on or off on the board. */
  z.object({ kind: z.literal("verification-toggled"), verify: z.boolean() }),
  /** The user saved a memory file in the Memory editor. */
  z.object({ kind: z.literal("memory-edited"), file: memoryFileSchema }),
  /** A reminder the coordinating thread set came due at `dueAt`; `everyMs` is how often it repeats (null: it was a one-off, and is gone). */
  z.object({ kind: z.literal("reminder"), reminderId: reminderIdSchema, note: reminderNoteSchema, dueAt: z.number(), everyMs: z.number().int().positive().nullable() }),
]);
export type InboxEvent = z.infer<typeof inboxEventSchema>;

/** An event as stored: numbered in the order it was recorded, at the time it was. */
export type StoredEvent = { id: number; at: number; event: InboxEvent };

/**
 * Whether an event of each kind wakes its coordinating thread on its own. One that doesn't waits,
 * unannounced, for the next one that does, and is listed in that doorbell and in the catch-up. why
 * `sent-back` doesn't: it leaves the thread nothing to do, and a turn costs tokens and context.
 */
const WAKES: Record<InboxEvent["kind"], boolean> = {
  handoff: true,
  checked: true,
  "sent-back": false,
  "idle-without-handoff": true,
  failed: true,
  "needs-input": true,
  pr: true,
  "verification-toggled": true,
  "memory-edited": true,
  reminder: true,
};

export const wakes = (event: InboxEvent): boolean => WAKES[event.kind];

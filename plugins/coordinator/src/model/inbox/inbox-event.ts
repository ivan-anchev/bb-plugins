// What the plugin tells a coordinating thread about: every fact it observes about the crews and the
// memory, stored whole. Crew-written text (an answer, an error, a question) lives only here and in
// crew_catch_up, never in the doorbell that announces it.
import { z } from "zod";
import { handoffIdSchema, handoffStatusSchema } from "../handoff.ts";
import { memoryFileSchema } from "../memory-file.ts";
import { crewIdSchema } from "../role.ts";

export const inboxEventSchema = z.discriminatedUnion("kind", [
  /**
   * A crew called crew_handoff. A done one is announced here only if it was handed off before
   * verification existed; since then a done handoff is announced as `checked`.
   */
  z.object({ kind: z.literal("handoff"), crewId: crewIdSchema, handoffId: handoffIdSchema, status: handoffStatusSchema }),
  /** A crew's done handoff and its verdict, together: once the verdict is final, or at once when verification was off. */
  z.object({ kind: z.literal("checked"), crewId: crewIdSchema, handoffId: handoffIdSchema }),
  /** A crew's turn ended with no current handoff; `lastAnswer` is its last answer, whole (null: none). */
  z.object({ kind: z.literal("idle-without-handoff"), crewId: crewIdSchema, lastAnswer: z.string().nullable() }),
  /** A crew's thread failed; `error` is bb's message for it (null: none). */
  z.object({ kind: z.literal("failed"), crewId: crewIdSchema, error: z.string().nullable() }),
  /** A crew waits on the user's answer or approval in its thread; `question` says what it asks. */
  z.object({ kind: z.literal("needs-input"), crewId: crewIdSchema, question: z.string() }),
  /** The user turned verification of done handoffs on or off on the board. */
  z.object({ kind: z.literal("verification-toggled"), verify: z.boolean() }),
  /** The user saved a memory file in the Memory editor. */
  z.object({ kind: z.literal("memory-edited"), file: memoryFileSchema }),
]);
export type InboxEvent = z.infer<typeof inboxEventSchema>;

/** An event as stored: numbered in the order it was recorded, at the time it was. */
export type StoredEvent = { id: number; at: number; event: InboxEvent };

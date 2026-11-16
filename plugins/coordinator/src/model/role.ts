// What a thread is to this plugin. A role is fixed before the thread's first session, because
// bb applies tools and instructions only when it constructs a provider session.
import { z } from "zod";
import { handoffIdSchema } from "./handoff.ts";

export const coordinatorIdSchema = z.uuid().brand<"coordinatorId">();
export type CoordinatorId = z.infer<typeof coordinatorIdSchema>;

/** A crew's id within its coordinating thread: `c1`, `c2`… in the order they were started. */
export const crewIdSchema = z.string().regex(/^c[1-9][0-9]*$/, "A crew id is c1, c2 and so on").brand<"crewId">();
export type CrewId = z.infer<typeof crewIdSchema>;

export const roleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coordinator"), coordinatorId: coordinatorIdSchema }),
  z.object({ kind: z.literal("crew"), coordinatorId: coordinatorIdSchema, crewId: crewIdSchema }),
  /** A hidden thread the plugin starts to check one done handoff of a crew. */
  z.object({ kind: z.literal("verifier"), coordinatorId: coordinatorIdSchema, crewId: crewIdSchema, handoffId: handoffIdSchema }),
]);
export type Role = z.infer<typeof roleSchema>;

/** What a role thread's metadata carries until it is bound: untrusted, a lookup key only. */
export const ticketMetadataSchema = z.object({ ticket: z.string() });

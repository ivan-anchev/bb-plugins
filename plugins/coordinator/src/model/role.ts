// What a thread is to this plugin. A role is fixed before the thread's first session, because
// bb applies tools and instructions only when it constructs a provider session.
import { z } from "zod";

export const coordinatorIdSchema = z.uuid().brand<"coordinatorId">();
export type CoordinatorId = z.infer<typeof coordinatorIdSchema>;

// why a union of one: crew threads and verifiers join it (issues 03 and 06).
export const roleSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("coordinator"), coordinatorId: coordinatorIdSchema })]);
export type Role = z.infer<typeof roleSchema>;

/** What a role thread's metadata carries until it is bound: untrusted, a lookup key only. */
export const ticketMetadataSchema = z.object({ ticket: z.string() });

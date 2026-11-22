import { z } from "zod";
import { agentIdSchema } from "./agent.ts";
import { issueIdSchema } from "./issue/issue.ts";
import { checkIdSchema } from "./verdict/check.ts";

export const coordinatorIdSchema = z.uuid().brand<"coordinatorId">();
export type CoordinatorId = z.infer<typeof coordinatorIdSchema>;

/** What a thread is to this plugin: a regional manager, one of its agents, or one of its verifiers. */
export const roleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coordinator"), coordinatorId: coordinatorIdSchema }),
  z.object({ kind: z.literal("agent"), coordinatorId: coordinatorIdSchema, agentId: agentIdSchema }),
  z.object({ kind: z.literal("verifier"), coordinatorId: coordinatorIdSchema, issueId: issueIdSchema, checkId: checkIdSchema }),
]);
export type Role = z.infer<typeof roleSchema>;

/** What a role thread's metadata carries until it is bound: untrusted, a lookup key only. */
export const ticketMetadataSchema = z.object({ ticket: z.string() });

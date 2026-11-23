// What a thread is to this plugin. A role is fixed before the thread's first session, because
// bb applies tools and instructions only when it constructs a provider session.
import { z } from "zod";
import { agentIdSchema } from "./agent/agent.ts";
import { issueIdSchema } from "./issue/issue.ts";
import { checkIdSchema } from "./verdict/check.ts";

export const coordinatorIdSchema = z.uuid().brand<"coordinatorId">();
export type CoordinatorId = z.infer<typeof coordinatorIdSchema>;

/** What a thread is to this plugin: a regional manager, one of its agents, or one of its verifiers or reviewers. */
export const roleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coordinator"), coordinatorId: coordinatorIdSchema }),
  /** A child thread holding one issue. */
  z.object({ kind: z.literal("agent"), coordinatorId: coordinatorIdSchema, agentId: agentIdSchema }),
  /** A hidden thread the plugin starts to run one check of an issue. */
  z.object({ kind: z.literal("verifier"), coordinatorId: coordinatorIdSchema, issueId: issueIdSchema, checkId: checkIdSchema }),
  /** A hidden thread the plugin starts to review the diff of the done handoff one check judges, before its verifier starts. */
  z.object({ kind: z.literal("reviewer"), coordinatorId: coordinatorIdSchema, issueId: issueIdSchema, checkId: checkIdSchema }),
]);

/** A hidden thread the plugin starts for one check: its verifier, or its reviewer. */
export type CheckerRole = Extract<Role, { kind: "verifier" | "reviewer" }>;
export type Role = z.infer<typeof roleSchema>;

/** What a role thread's metadata carries until it is bound: untrusted, a lookup key only. */
export const ticketMetadataSchema = z.object({ ticket: z.string() });

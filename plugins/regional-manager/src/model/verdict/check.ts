// A check: one verifier's job on an issue, and its verdict. Today's only subject is an agent's done
// handoff of a verified kind; what a check judges is its subject, so another (a parent's final
// check) is a new variant, stored in the same JSON column.
import { z } from "zod";
import { agentIdSchema } from "../agent.ts";
import type { Execution } from "../execution.ts";
import { commitSchema, handoffIdSchema } from "../handoff.ts";
import type { DoneCriteria, IssueId } from "../issue/issue.ts";
import type { CoordinatorId } from "../role.ts";
import type { Verdict } from "./verdict.ts";

export const checkIdSchema = z.uuid().brand<"checkId">();
export type CheckId = z.infer<typeof checkIdSchema>;

/** What a check judges: an agent's done handoff, the commit it claims and the pull request it names. */
export const checkSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("handoff"), agentId: agentIdSchema, handoffId: handoffIdSchema, headSha: commitSchema, prUrl: z.string().nullable() }),
]);
export type CheckSubject = z.infer<typeof checkSubjectSchema>;

export type Check = {
  id: CheckId;
  coordinatorId: CoordinatorId;
  issueId: IssueId;
  at: number;
  /** The issue's criteria when it was made. why copied: the manager may edit the issue's meanwhile, and a verdict judges what its verifier was given. */
  criteria: DoneCriteria;
  /** The issue's verifier when it was made, copied as the criteria are (null: the plugin picks). */
  verifier: Execution | null;
  subject: CheckSubject;
  verdict: Verdict;
};

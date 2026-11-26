// A check: one verifier's job on an issue, and its verdict; for a done handoff, the review read before it. What a check judges is its subject: an
// agent's done handoff of a verified kind, or a build parent's final check on the default branch,
// stored in the same JSON column. One state machine judges both; the subject says where the
// commit and the tree are read, which commit is judged, and whether a fix round exists.
import { z } from "zod";
import { agentIdSchema, type Agent } from "../agent/agent.ts";
import type { Execution } from "../agent/execution.ts";
import { commitSchema, handoffIdSchema } from "../agent/handoff.ts";
import { issueIdSchema, type DoneCriteria, type IssueId } from "../issue/issue.ts";
import type { CoordinatorId } from "../role.ts";
import type { Review } from "./review.ts";
import type { StoredVerdict, Verdict } from "./verdict.ts";

export const checkIdSchema = z.uuid().brand<"checkId">();
export type CheckId = z.infer<typeof checkIdSchema>;

/**
 * A build parent's final check: its own done-criteria, on the default branch `defaultBranch`, once
 * the work of `merged`, its Done build sub-issues, was all merged there. No commit is named: its
 * verifier works in a fresh worktree that bb starts at origin's tip of the default branch, and the
 * commit judged is the one that worktree holds when the verifier returns, read then.
 */
const finalSubjectSchema = z.object({ kind: z.literal("final"), defaultBranch: z.string().min(1), merged: z.array(issueIdSchema) });

/** What a check judges: an agent's done handoff, the commit it claims and the pull request it names; or a build parent's final check. */
export const checkSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("handoff"), agentId: agentIdSchema, handoffId: handoffIdSchema, headSha: commitSchema, prUrl: z.string().nullable() }),
  finalSubjectSchema,
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
  /** Its review (review.ts): a handoff's diff, read before its verifier starts. */
  review: Review;
  verdict: Verdict;
  /** The follow-up issue its findings that held without blocking were filed in when its issue passed, or, on the passing check, the one its pass filed (rounds/follow-up.ts); null: none. */
  followUpId: IssueId | null;
};

/** A check as its row stores it: its verdict not yet joined with the findings its verifier triaged (rounds/delta.ts readInOrder). */
export type StoredCheck = Omit<Check, "verdict"> & { verdict: StoredVerdict };

/** A build parent's final check. */
export type FinalCheck = Check & { subject: z.infer<typeof finalSubjectSchema> };

/** A check of an agent's done handoff. */
export type HandoffCheck = Check & { subject: Extract<CheckSubject, { kind: "handoff" }> };

/**
 * Of `agents`, those whose work the check judges, whose models its verifier keeps away from: the
 * one that handed off; for a final check, every one that held a Done build sub-issue whose merged
 * work it judges.
 */
export function checkedAgents<A extends Pick<Agent, "id" | "issueId">>({ subject }: Pick<Check, "subject">, agents: readonly A[]): A[] {
  switch (subject.kind) {
    case "handoff":
      return agents.filter(({ id }) => id === subject.agentId);
    case "final":
      return agents.filter(({ issueId }) => subject.merged.includes(issueId));
    default:
      return subject satisfies never;
  }
}

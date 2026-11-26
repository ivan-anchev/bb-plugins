// An issue: one unit of the regional manager's work, outliving any agent that works on it. The
// plugin's database holds its plan; what happens to it (agents, handoffs, checks, pull requests)
// is stored beside it as facts, and its status is derived from both (status.ts).
import { z } from "zod";
import type { Execution } from "../agent/execution.ts";
import { ONE_LINE } from "../one-line.ts";
import type { CoordinatorId } from "../role.ts";
import type { IssueKey } from "./key/issue-key.ts";
import { isVerified, minCriteria, PIPELINES, type Kind } from "./kind.ts";

/** An issue's id within its regional manager: its issue key (issue-key.ts) and its number, `BBP-1`, `BBP-2`… never reused. */
export const issueIdSchema = z.string().regex(/^[A-Z]{1,3}-[1-9][0-9]*$/, "An issue id is the project's key and a number, such as BBP-4").brand<"issueId">();
export type IssueId = z.infer<typeof issueIdSchema>;

/** The id of the regional manager's issue numbered `number`, whose key is `key`. */
export const issueIdOf = (key: IssueKey, number: number): IssueId => issueIdSchema.parse(`${key}-${number}`);

export const titleSchema = z.string().trim().min(1).max(80).regex(ONE_LINE, "A title is one line");

/** What the issue is about, in plain words, for the user. why short: the board shows it whole. */
export const descriptionSchema = z.string().trim().min(1).max(2_000);

/** The agent's instructions: everything it needs to start without asking. */
export const briefSchema = z.string().trim().min(1).max(20_000);

/** The most done-criteria an issue has, and the most characters in one. */
export const MAX_CRITERIA = 12;
const MAX_CRITERION_CHARS = 500;

/**
 * What "done" means: each one checkable by running something. Up to 12; the kind's minimum
 * (kind.ts minCriteria) is checked when an agent starts, not here: an issue is filed before it is
 * fully planned.
 */
export const doneCriteriaSchema = z.array(z.string().trim().min(1).max(MAX_CRITERION_CHARS)).max(MAX_CRITERIA);
export type DoneCriteria = z.infer<typeof doneCriteriaSchema>;

/** Where an issue rests while no agent's work places it: the manager's planning choice. */
export const restSchema = z.enum(["backlog", "todo"]);
export type Rest = z.infer<typeof restSchema>;

/** The manager's two closing acts. why not "done": Done by a merge is a fact, derived. */
export const closedAsSchema = z.enum(["canceled", "accepted"]);

/** What the manager may set as a status. why only these four: the others are evidence, derived (status.ts). */
export const managerStatusSchema = z.enum(["backlog", "todo", "canceled", "done"]);

export type Issue = {
  id: IssueId;
  coordinatorId: CoordinatorId;
  kind: Kind;
  title: string;
  description: string;
  /** null: not written yet. No agent can start without one. */
  brief: string | null;
  doneCriteria: DoneCriteria;
  /** What checks its done handoffs, as the manager named it; null: the plugin picks. */
  verifier: Execution | null;
  rest: Rest;
  /** The issue it is a sub-issue of, one level deep (plan.ts); null: none. A parent has no agent, and its status rolls up from its sub-issues (status.ts). */
  parentId: IssueId | null;
  /** The issues it depends on, in the order added: it is blocked while any of them, or of its parent's, is open (relations.ts). */
  dependsOn: IssueId[];
  closed: null | { as: z.infer<typeof closedAsSchema>; at: number };
  createdAt: number;
};

/** An issue as it is filed: what the manager gives it, or a follow-up the plugin files (rounds/follow-up.ts). */
export type NewIssue = Pick<Issue, "kind" | "title" | "description" | "brief" | "doneCriteria" | "verifier" | "rest" | "parentId" | "dependsOn">;

/** The brief an agent starts from, or why none can start on the issue as it is planned. */
export function briefToStart(issue: Pick<Issue, "id" | "kind" | "brief" | "doneCriteria">): { brief: string } | { refused: string } {
  if (issue.brief === null) return { refused: `${issue.id} has no brief yet. Write one with issue_update.` };
  const fewest = minCriteria(issue.kind);
  if (issue.doneCriteria.length < fewest) return { refused: `${issue.id} needs done-criteria (at least ${fewest}) before an agent starts. Add doneCriteria with issue_update.` };
  return { brief: issue.brief };
}

/**
 * Why an issue of `kind` can't have a verifier named, or null when it can. why one rule, read on
 * the plan as it would be: filing a research issue with a verifier, naming one on a research issue,
 * and making an issue that names one research would each leave a verifier that never runs.
 */
export function verifierProblem(kind: Kind, namesVerifier: boolean): string | null {
  if (!namesVerifier || isVerified(kind)) return null;
  const label = PIPELINES[kind].label.toLowerCase();
  return `a ${label} issue has no verifier: nothing verifies it`;
}

// A regional manager's open work as its card lists it, read through the Regional Manager plugin's
// published `openIssues` (its skills/crew-board/SKILL.md), parsed with this copy of its schema: a
// plugin imports nothing from another.
import { z } from "zod";

/** An issue's status on its manager's Board. */
const issueStatusSchema = z.enum(["backlog", "todo", "in-progress", "reviewing", "verifying", "in-review", "done", "canceled"]);
export type IssueStatus = z.infer<typeof issueStatusSchema>;

/** The Board's name of each status. */
export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In progress",
  reviewing: "Reviewing",
  verifying: "Verifying",
  "in-review": "In review",
  done: "Done",
  canceled: "Canceled",
};

const issueSchema = z.object({ id: z.string().min(1), title: z.string(), status: issueStatusSchema });
const listedSchema = issueSchema.extend({ parentId: z.string().min(1).nullable() });

/**
 * One manager's open work. `needsYou`: the issues waiting on the user, with why, in the order filed.
 * `underWay`: the Verifying, Reviewing and In progress ones, in the Board's order. `parents`: the
 * parent of a listed sub-issue, when it is in neither list. `decisions`: the open decisions naming no
 * listed issue.
 */
export const managerIssuesSchema = z.object({
  needsYou: z.array(listedSchema.extend({ reason: z.string() })),
  underWay: z.array(listedSchema),
  parents: z.array(issueSchema),
  decisions: z.array(z.object({ id: z.string().min(1), question: z.string() })),
});
export type ManagerIssues = z.infer<typeof managerIssuesSchema>;

/** The `openIssues` read's output: each manager's open work, keyed by its id. */
export const openIssuesReadSchema = z.record(z.string(), managerIssuesSchema);

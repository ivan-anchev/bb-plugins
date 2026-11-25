// What another plugin reads of a board's open work (the published `openIssues`): the issues waiting
// on the user, the issues under way, the parents a listed sub-issue hangs under when they aren't
// listed themselves, and the open decisions that name no listed issue. Placed by the board's own
// rule (board-groups.ts laneOf) from the board's own rows, so it never disagrees with the Board.
import { z } from "zod";
import { decisionIdSchema, isOpen, type Decision } from "../decision.ts";
import { issueIdSchema, type IssueId } from "../issue/issue.ts";
import { issueStatusSchema, type IssueStatus } from "../issue/status.ts";
import { laneOf } from "./board-groups.ts";

/** The lanes of work under way, in the board's order. why not In review: it waits on a merge, not on work. */
const UNDER_WAY: readonly IssueStatus[] = ["verifying", "reviewing", "in-progress"];

const listedSchema = z.object({ id: issueIdSchema, title: z.string(), status: issueStatusSchema, parentId: issueIdSchema.nullable() });

/**
 * One board's open work. `needsYou`: every issue under Needs you, a flagged sub-issue included, with
 * why, in the order filed. `underWay`: every Verifying, Reviewing and In progress issue not under
 * Needs you, in the board's order. `parents`: the parent of a listed sub-issue, when it is in
 * neither list. `decisions`: the open decisions whose issue (if any) is in neither list.
 */
export const openIssuesSchema = z.object({
  needsYou: z.array(listedSchema.extend({ reason: z.string() })),
  underWay: z.array(listedSchema),
  parents: z.array(listedSchema.omit({ parentId: true })),
  decisions: z.array(z.object({ id: decisionIdSchema, question: z.string() })),
});
export type OpenIssues = z.infer<typeof openIssuesSchema>;

/** What an issue's board row says that its open work reads. */
type Row = { id: IssueId; title: string; status: IssueStatus; parentId: IssueId | null; needsYou: string | null };

/** The board's open work, from its decisions and its issues' rows, both in the board's order. */
export function openIssues(decisions: readonly Decision[], rows: readonly Row[]): OpenIssues {
  // why the reason read, not laneOf: a row is under Needs you exactly when it has one (laneOf).
  const needsYou = rows.flatMap((row) => (row.needsYou === null ? [] : [{ ...listed(row), reason: row.needsYou }]));
  const underWay = UNDER_WAY.flatMap((status) => rows.filter((row) => laneOf(row) === status).map(listed));
  const isListed = new Set([...needsYou, ...underWay].map(({ id }) => id));
  const parentIds = new Set([...needsYou, ...underWay].flatMap(({ parentId }) => (parentId === null || isListed.has(parentId) ? [] : [parentId])));
  return {
    needsYou,
    underWay,
    parents: rows.filter(({ id }) => parentIds.has(id)).map(({ id, title, status }) => ({ id, title, status })),
    decisions: decisions.filter(isOpen).flatMap(({ id, issueId, question }) => (issueId !== null && isListed.has(issueId) ? [] : [{ id, question }])),
  };
}

const listed = ({ id, title, status, parentId }: Row) => ({ id, title, status, parentId });

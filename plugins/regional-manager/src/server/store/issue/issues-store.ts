// Issues: the regional manager's plan. A write that a concurrent one could invalidate (numbering,
// "no agent holds it") decides and writes in one transaction. Rows are parsed into Issue here and
// nowhere else.
import { z } from "zod";
import { executionSchema } from "../../../model/execution.ts";
import { closedAsSchema, doneCriteriaSchema, issueIdSchema, restSchema, type Issue, type IssueId, type Rest } from "../../../model/issue/issue.ts";
import { kindSchema } from "../../../model/issue/kind.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../model/role.ts";
import { json, jsonOrNull, nullableJson, type Db } from "../rows.ts";

/** An issue as the manager files it. */
export type NewIssue = Pick<Issue, "kind" | "title" | "description" | "brief" | "doneCriteria" | "verifier" | "rest">;

/** A change to an issue's plan; a field left out stays as it is. */
export type IssueEdit = Partial<Pick<Issue, "title" | "description" | "brief" | "doneCriteria" | "verifier" | "rest" | "closed">>;

/** Puts the issue to rest as `rest`. Call inside the transaction that decides it, as an agent's start does: losing its agent then leaves it in Todo. */
export function restIssue(db: Db, coordinatorId: CoordinatorId, id: IssueId, rest: Rest): void {
  db().prepare("UPDATE issues SET rest = ? WHERE coordinator_id = ? AND id = ?").run(rest, coordinatorId, id);
}

export function issuesStore(db: Db) {
  function issues(coordinatorId: CoordinatorId, id: IssueId | null): Issue[] {
    return db().prepare(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE coordinator_id = ? AND (? IS NULL OR id = ?) ORDER BY rowid`).all(coordinatorId, id, id).map(toIssue);
  }

  return {
    /** Every issue of the regional manager, in the order filed. */
    issues: (coordinatorId: CoordinatorId): Issue[] => issues(coordinatorId, null),

    /** One issue of the regional manager, or null when it has none by that id. */
    issue: (coordinatorId: CoordinatorId, id: IssueId): Issue | null => issues(coordinatorId, id)[0] ?? null,

    /** Files an issue, numbered after the regional manager's highest. */
    insertIssue(coordinatorId: CoordinatorId, issue: NewIssue, at: number): Issue {
      return db().transaction(() => {
        // why the highest, not a count: an id is never reused, whatever happens to the issues before it.
        const { last } = z.object({ last: z.number().nullable() }).parse(db().prepare("SELECT max(CAST(substr(id, 2) AS INTEGER)) AS last FROM issues WHERE coordinator_id = ?").get(coordinatorId));
        const filed: Issue = { id: issueIdSchema.parse(`i${(last ?? 0) + 1}`), coordinatorId, ...issue, closed: null, createdAt: at };
        db()
          .prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, brief, done_criteria, verifier, rest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(coordinatorId, filed.id, filed.kind, filed.title, filed.description, filed.brief, JSON.stringify(filed.doneCriteria), jsonOrNull(filed.verifier), filed.rest, at);
        return filed;
      })();
    },

    /**
     * Applies the edit, or says why it can't. `requireUnheld`: refused while an agent holds the
     * issue, decided in the same transaction, so an agent starting meanwhile is seen.
     */
    updateIssue(coordinatorId: CoordinatorId, id: IssueId, edit: IssueEdit, { requireUnheld }: { requireUnheld: boolean }): { issue: Issue } | { refused: string } {
      return db().transaction(() => {
        const now = issues(coordinatorId, id)[0];
        if (now === undefined) return { refused: `You have no issue ${id}.` };
        if (requireUnheld && db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ? AND ended_at IS NULL").get(coordinatorId, id) !== undefined) {
          return { refused: `An agent holds ${id}. Stop it with agent_stop first.` };
        }
        const next: Issue = { ...now, ...edit };
        db()
          .prepare("UPDATE issues SET title = ?, description = ?, brief = ?, done_criteria = ?, verifier = ?, rest = ?, closed_as = ?, closed_at = ? WHERE coordinator_id = ? AND id = ?")
          .run(next.title, next.description, next.brief, JSON.stringify(next.doneCriteria), jsonOrNull(next.verifier), next.rest, next.closed?.as ?? null, next.closed?.at ?? null, coordinatorId, id);
        return { issue: next };
      })();
    },
  };
}

const ISSUE_COLUMNS = `coordinator_id AS coordinatorId, id, kind, title, description, brief, done_criteria AS doneCriteria, verifier, rest,
  closed_as AS closedAs, closed_at AS closedAt, created_at AS createdAt`;

const issueRowSchema = z.object({
  coordinatorId: coordinatorIdSchema,
  id: issueIdSchema,
  kind: kindSchema,
  title: z.string(),
  description: z.string(),
  brief: z.string().nullable(),
  doneCriteria: json(doneCriteriaSchema),
  verifier: nullableJson(executionSchema),
  rest: restSchema,
  createdAt: z.number(),
});
// why a union: how and when it was closed are written together, or not at all.
const closedColumnsSchema = z.union([
  z.object({ closedAs: z.null(), closedAt: z.null() }).transform(() => null),
  z.object({ closedAs: closedAsSchema, closedAt: z.number() }).transform(({ closedAs, closedAt }) => ({ as: closedAs, at: closedAt })),
]);
const toIssue = (row: unknown): Issue => ({ ...issueRowSchema.parse(row), closed: closedColumnsSchema.parse(row) });

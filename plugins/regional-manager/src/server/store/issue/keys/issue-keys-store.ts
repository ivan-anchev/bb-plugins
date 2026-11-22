import { z } from "zod";
import type { IssueKey } from "../../../../model/issue/key/issue-key.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../../model/role.ts";
import type { Db } from "../../rows.ts";

export function issueKeysStore(db: Db) {
  return {
    unkeyedManagers(): { id: CoordinatorId; projectId: string }[] {
      return db()
        .prepare("SELECT c.id, c.project_id AS projectId FROM coordinators c JOIN roles r ON r.ticket = c.ticket WHERE r.thread_id IS NOT NULL AND c.issue_key IS NULL")
        .all()
        .map((row) => unkeyedRowSchema.parse(row));
    },

    keyIssues(id: CoordinatorId, key: IssueKey): boolean {
      return db().transaction(() => {
        if (db().prepare("UPDATE coordinators SET issue_key = ? WHERE id = ? AND issue_key IS NULL").run(key, id).changes === 0) return false;
        db().pragma("defer_foreign_keys = ON");
        for (const rename of RENAMES) db().prepare(rename).run({ id, key });
        return true;
      })();
    },
  };
}

const unkeyedRowSchema = z.object({ id: coordinatorIdSchema, projectId: z.string() });

const keyed = (value: string): string => `CASE WHEN ${value} GLOB 'i[1-9]*' THEN @key || '-' || substr(${value}, 2) ELSE ${value} END`;

const RENAMES: readonly string[] = [
  ...[
    ["issues", "id"],
    ["issues", "parent_id"],
    ["issue_relations", "issue_id"],
    ["issue_relations", "depends_on"],
    ["agents", "issue_id"],
    ["handoffs", "issue_id"],
    ["checks", "issue_id"],
    ["decisions", "issue_id"],
    ["issue_decisions", "issue_id"],
  ].map(([table, column]) => `UPDATE ${table} SET ${column} = ${keyed(column)} WHERE coordinator_id = @id`),
  ...["$.issueId", "$.by"].map(
    (path) => `UPDATE events SET event = json_set(event, '${path}', ${keyed(`json_extract(event, '${path}')`)}) WHERE coordinator_id = @id AND json_extract(event, '${path}') IS NOT NULL`,
  ),
  `UPDATE roles SET role = json_set(role, '$.issueId', ${keyed("json_extract(role, '$.issueId')")})
     WHERE json_extract(role, '$.coordinatorId') = @id AND json_extract(role, '$.issueId') IS NOT NULL`,
  `UPDATE checks SET subject = json_set(subject, '$.merged', json((SELECT json_group_array(${keyed("value")}) FROM json_each(subject, '$.merged'))))
     WHERE coordinator_id = @id AND json_extract(subject, '$.kind') = 'final'`,
];

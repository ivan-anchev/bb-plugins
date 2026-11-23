// Issue keys for the regional managers started before them, whose issues are numbered i1, i2…: each
// one's key is written with every issue id it stores renamed after it, i4 to BBP-4, the number kept,
// in one transaction. Text written before, a memory file, a handoff, a message or a reminder's note,
// says i4 as it was written; the number lets a reader map it.
import { z } from "zod";
import type { IssueKey } from "../../../../model/issue/key/issue-key.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../../model/role.ts";
import type { Db } from "../../rows.ts";

export function issueKeysStore(db: Db) {
  return {
    /** Every started regional manager whose issues have no key yet, with the project its key is taken from. */
    unkeyedManagers(): { id: CoordinatorId; projectId: string }[] {
      return db()
        .prepare("SELECT c.id, c.project_id AS projectId FROM coordinators c JOIN roles r ON r.ticket = c.ticket WHERE r.thread_id IS NOT NULL AND c.issue_key IS NULL")
        .all()
        .map((row) => unkeyedRowSchema.parse(row));
    },

    /**
     * Gives the regional manager the issue key `key`, renaming every issue id it stores after it, and
     * returns whether it did. Idempotent: a manager keys once, so a second call, or one with another
     * key, changes nothing and returns false.
     */
    keyIssues(id: CoordinatorId, key: IssueKey): boolean {
      return db().transaction(() => {
        if (db().prepare("UPDATE coordinators SET issue_key = ? WHERE id = ? AND issue_key IS NULL").run(key, id).changes === 0) return false;
        // why deferred: an issue's id and the rows naming it change one statement at a time, and the handle enforces foreign keys. They hold again by the commit.
        db().pragma("defer_foreign_keys = ON");
        for (const rename of RENAMES) db().prepare(rename).run({ id, key });
        return true;
      })();
    },
  };
}

const unkeyedRowSchema = z.object({ id: coordinatorIdSchema, projectId: z.string() });

/** `value`, an issue id as it was stored before issue keys (`i4`), renamed after `@key` (`BBP-4`); anything else as it is. */
const keyed = (value: string): string => `CASE WHEN ${value} GLOB 'i[1-9]*' THEN @key || '-' || substr(${value}, 2) ELSE ${value} END`;

/** Every issue id the regional manager `@id` stores, renamed: each column that holds one, and each place in a JSON column (inbox-event.ts, role.ts, check.ts, log-event.ts). */
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
    ["issue_log", "issue_id"],
  ].map(([table, column]) => `UPDATE ${table} SET ${column} = ${keyed(column)} WHERE coordinator_id = @id`),
  ...["$.issueId", "$.by"].map(
    (path) => `UPDATE events SET event = json_set(event, '${path}', ${keyed(`json_extract(event, '${path}')`)}) WHERE coordinator_id = @id AND json_extract(event, '${path}') IS NOT NULL`,
  ),
  // An issue's log names its parent and its dependencies (log-event.ts).
  ...["$.parentId", "$.on"].map(
    (path) => `UPDATE issue_log SET event = json_set(event, '${path}', ${keyed(`json_extract(event, '${path}')`)}) WHERE coordinator_id = @id AND json_extract(event, '${path}') IS NOT NULL`,
  ),
  `UPDATE roles SET role = json_set(role, '$.issueId', ${keyed("json_extract(role, '$.issueId')")})
     WHERE json_extract(role, '$.coordinatorId') = @id AND json_extract(role, '$.issueId') IS NOT NULL`,
  // why json(): a subquery's result loses its JSON subtype, and json_set would store the array as a string.
  `UPDATE checks SET subject = json_set(subject, '$.merged', json((SELECT json_group_array(${keyed("value")}) FROM json_each(subject, '$.merged'))))
     WHERE coordinator_id = @id AND json_extract(subject, '$.kind') = 'final'`,
  // why merged into the new id's count: the renames above count writes under the new ids as they go.
  `INSERT INTO issue_writes (coordinator_id, issue_id, writes)
     SELECT coordinator_id, ${keyed("issue_id")}, writes FROM issue_writes WHERE coordinator_id = @id AND issue_id GLOB 'i[1-9]*'
     ON CONFLICT (coordinator_id, issue_id) DO UPDATE SET writes = writes + excluded.writes`,
  `DELETE FROM issue_writes WHERE coordinator_id = @id AND issue_id GLOB 'i[1-9]*'`,
];

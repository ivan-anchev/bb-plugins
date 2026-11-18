// Issues: the regional manager's plan, with what each depends on. A write that a concurrent one
// could invalidate (numbering, "no agent holds it", a dependency cycle) decides and writes in one
// transaction. Rows are parsed into Issue here and nowhere else.
import { z } from "zod";
import { executionSchema } from "../../../model/execution.ts";
import { closedAsSchema, doneCriteriaSchema, issueIdSchema, restSchema, verifierProblem, type Issue, type IssueId, type Rest } from "../../../model/issue/issue.ts";
import { kindSchema } from "../../../model/issue/kind.ts";
import { relationProblem, type CloseKey, type Closes, type KnownCloses } from "../../../model/issue/relations.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../model/role.ts";
import { json, jsonOrNull, nullableJson, type Db } from "../rows.ts";

/** An issue as the manager files it. */
export type NewIssue = Pick<Issue, "kind" | "title" | "description" | "brief" | "doneCriteria" | "verifier" | "rest" | "dependsOn">;

/** A change to an issue's plan; a field left out stays as it is. Dependencies change by what is added and removed, so two edits at once both apply. */
export type IssueEdit = Partial<Pick<Issue, "kind" | "title" | "description" | "brief" | "doneCriteria" | "verifier" | "rest" | "closed">> & { dependsOn?: DependencyEdit };

/** Dependencies an edit adds and removes. */
export type DependencyChange = { add: IssueId[]; remove: IssueId[] };

/** Dependencies an edit adds and removes, with every issue's close as the read the manager is answered from says (see writeDependencies). */
export type DependencyEdit = DependencyChange & { closes: Closes };

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

    /**
     * Files an issue, numbered after the regional manager's highest, or says why its dependencies
     * can't stand (relationProblem), filing nothing. `closes`: every issue's close as the read the
     * manager is answered from says (see writeDependencies).
     */
    insertIssue(coordinatorId: CoordinatorId, issue: NewIssue, closes: Closes, at: number): { issue: Issue } | { refused: string } {
      return db().transaction(() => {
        // why the highest, not a count: an id is never reused, whatever happens to the issues before it.
        const { last } = z.object({ last: z.number().nullable() }).parse(db().prepare("SELECT max(CAST(substr(id, 2) AS INTEGER)) AS last FROM issues WHERE coordinator_id = ?").get(coordinatorId));
        const filed: Issue = { id: issueIdSchema.parse(`i${(last ?? 0) + 1}`), coordinatorId, ...issue, dependsOn: unique(issue.dependsOn), closed: null, createdAt: at };
        const problem = relationProblem(issues(coordinatorId, null), filed);
        if (problem !== null) return { refused: `${problem}.` };
        db()
          .prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, brief, done_criteria, verifier, rest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(coordinatorId, filed.id, filed.kind, filed.title, filed.description, filed.brief, JSON.stringify(filed.doneCriteria), jsonOrNull(filed.verifier), filed.rest, at);
        writeDependencies(db, filed, closes);
        return { issue: filed };
      })();
    },

    /**
     * Applies the edit, or says why it can't. `requireUnheld`: refused while an agent holds the
     * issue. Decided in the same transaction, so an agent starting meanwhile is seen: the kind is
     * fixed once any agent has started on the issue, and the plan as it would be must stand
     * (verifierProblem), its dependencies among the issues as they are now included (relationProblem).
     */
    updateIssue(coordinatorId: CoordinatorId, id: IssueId, edit: IssueEdit, { requireUnheld }: { requireUnheld: boolean }): { issue: Issue } | { refused: string } {
      return db().transaction(() => {
        const now = issues(coordinatorId, id)[0];
        if (now === undefined) return { refused: `You have no issue ${id}.` };
        if (requireUnheld && db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ? AND ended_at IS NULL").get(coordinatorId, id) !== undefined) {
          return { refused: `An agent holds ${id}. Stop it with agent_stop first.` };
        }
        if (edit.kind !== undefined && edit.kind !== now.kind && db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ?").get(coordinatorId, id) !== undefined) {
          return { refused: `An agent has started on ${id}, so its kind stays ${now.kind}. File a new issue of the other kind instead.` };
        }
        const { dependsOn, ...fields } = edit;
        const next: Issue = { ...now, ...fields, dependsOn: dependsOn === undefined ? now.dependsOn : changedDependencies(now.dependsOn, dependsOn) };
        const problem = verifierProblem(next.kind, next.verifier !== null);
        if (problem !== null) return { refused: `${id} can't be changed so: ${problem}. Give verifier: null with the change to drop the one named.` };
        const relations = dependsOn === undefined ? null : relationProblem(issues(coordinatorId, null), next);
        if (relations !== null) return { refused: `${relations}.` };
        db()
          .prepare("UPDATE issues SET kind = ?, title = ?, description = ?, brief = ?, done_criteria = ?, verifier = ?, rest = ?, closed_as = ?, closed_at = ? WHERE coordinator_id = ? AND id = ?")
          .run(next.kind, next.title, next.description, next.brief, JSON.stringify(next.doneCriteria), jsonOrNull(next.verifier), next.rest, next.closed?.as ?? null, next.closed?.at ?? null, coordinatorId, id);
        if (dependsOn !== undefined) writeDependencies(db, next, dependsOn.closes);
        return { issue: next };
      })();
    },
  };
}

/**
 * Writes the issue's dependencies as `dependsOn` lists them, in that order, over the relations it
 * has: a removed one's relation is deleted with the close known of it, a kept one keeps its own,
 * and an added one is written knowing its dependency's close as `closes` says, the read the manager
 * is answered from ("blocked by i1"). So a dependency closed already then is no news, and any close
 * after is (relations.ts unblockedSince). why from that read, though it was made before the write:
 * a dependency that closes in between was told open, and its close is news; one reopened in between
 * and closed again is too. Either way the error falls to an announcement more, never one lost.
 * why rewrite the kept ones too: relations read back in the order written (ISSUE_COLUMNS), and an
 * edit can move a kept one, as removing and adding it again puts it last.
 */
function writeDependencies(db: Db, { coordinatorId, id, dependsOn }: Pick<Issue, "coordinatorId" | "id" | "dependsOn">, closes: Closes): void {
  const rows = db().prepare("SELECT depends_on AS dependsOn, known_close AS close FROM issue_relations WHERE coordinator_id = ? AND issue_id = ?").all(coordinatorId, id);
  const kept = new Map(rows.map((row) => keptRowSchema.parse(row)).map(({ dependsOn: dependency, close }) => [dependency, close]));
  db().prepare("DELETE FROM issue_relations WHERE coordinator_id = ? AND issue_id = ?").run(coordinatorId, id);
  const insert = db().prepare("INSERT INTO issue_relations (coordinator_id, issue_id, depends_on, known_close) VALUES (?, ?, ?, ?)");
  for (const dependency of dependsOn) insert.run(coordinatorId, id, dependency, kept.has(dependency) ? kept.get(dependency) : (closes.get(dependency) ?? null));
}

/** Of each of the regional manager's issues' dependencies, the close it knows of (relations.ts unblockedSince). Call inside the transaction that records what it learned. */
export function knownCloses(db: Db, coordinatorId: CoordinatorId): KnownCloses {
  const known = new Map<IssueId, Map<IssueId, CloseKey | null>>();
  for (const row of db().prepare("SELECT issue_id AS issueId, depends_on AS dependsOn, known_close AS close FROM issue_relations WHERE coordinator_id = ?").all(coordinatorId)) {
    const { issueId, dependsOn, close } = knownCloseRowSchema.parse(row);
    known.set(issueId, (known.get(issueId) ?? new Map<IssueId, CloseKey | null>()).set(dependsOn, close));
  }
  return known;
}

/** Remembers the closes learned of each issue's dependencies (relations.ts unblockedSince). Call inside the transaction that read what was known. */
export function rememberCloses(db: Db, coordinatorId: CoordinatorId, learned: ReadonlyMap<IssueId, ReadonlyMap<IssueId, CloseKey>>): void {
  const remember = db().prepare("UPDATE issue_relations SET known_close = ? WHERE coordinator_id = ? AND issue_id = ? AND depends_on = ?");
  for (const [issueId, closes] of learned) for (const [dependsOn, close] of closes) remember.run(close, coordinatorId, issueId, dependsOn);
}

const keptRowSchema = z.object({ dependsOn: issueIdSchema, close: z.string().nullable() });
const knownCloseRowSchema = keptRowSchema.extend({ issueId: issueIdSchema });

/** The dependencies with the change applied: the removed ones gone, the added ones after the rest. */
const changedDependencies = (dependsOn: readonly IssueId[], { add, remove }: DependencyChange): IssueId[] => unique([...dependsOn.filter((id) => !remove.includes(id)), ...add]);

const unique = (ids: readonly IssueId[]): IssueId[] => [...new Set(ids)];

// why a subquery: an issue is read with its dependencies, in the order they were written.
const ISSUE_COLUMNS = `coordinator_id AS coordinatorId, id, kind, title, description, brief, done_criteria AS doneCriteria, verifier, rest,
  closed_as AS closedAs, closed_at AS closedAt, created_at AS createdAt,
  (SELECT json_group_array(depends_on) FROM (SELECT depends_on FROM issue_relations r
     WHERE r.coordinator_id = issues.coordinator_id AND r.issue_id = issues.id ORDER BY r.rowid)) AS dependsOn`;

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
  dependsOn: json(z.array(issueIdSchema)),
  createdAt: z.number(),
});
// why a union: how and when it was closed are written together, or not at all.
const closedColumnsSchema = z.union([
  z.object({ closedAs: z.null(), closedAt: z.null() }).transform(() => null),
  z.object({ closedAs: closedAsSchema, closedAt: z.number() }).transform(({ closedAs, closedAt }) => ({ as: closedAs, at: closedAt })),
]);
const toIssue = (row: unknown): Issue => ({ ...issueRowSchema.parse(row), closed: closedColumnsSchema.parse(row) });

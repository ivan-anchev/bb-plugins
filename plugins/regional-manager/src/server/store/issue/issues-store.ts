import { z } from "zod";
import { agentIdSchema } from "../../../model/agent.ts";
import type { RecordedDecision } from "../../../model/decision.ts";
import { executionSchema } from "../../../model/execution.ts";
import { issueKeySchema } from "../../../model/issue/key/issue-key.ts";
import { closedAsSchema, doneCriteriaSchema, issueIdOf, issueIdSchema, restSchema, verifierProblem, type Issue, type IssueId, type Rest } from "../../../model/issue/issue.ts";
import { kindSchema } from "../../../model/issue/kind.ts";
import { planProblem } from "../../../model/issue/plan.ts";
import { knownClose, type CloseKey, type Closes, type KnownCloses } from "../../../model/issue/relations.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../model/role.ts";
import { json, jsonOrNull, nullableJson, type Db } from "../rows.ts";

/** An issue as the manager files it. */
export type NewIssue = Pick<Issue, "kind" | "title" | "description" | "brief" | "doneCriteria" | "verifier" | "rest" | "parentId" | "dependsOn">;

/**
 * A change to an issue's plan; a field left out stays as it is. Dependencies change by what is added
 * and removed, so two edits at once both apply. `decision`: one more recorded among its decisions.
 */
export type IssueEdit = Partial<Pick<Issue, "kind" | "title" | "description" | "brief" | "doneCriteria" | "verifier" | "rest" | "closed" | "parentId">> & {
  dependsOn?: DependencyChange;
  decision?: Omit<RecordedDecision, "kind">;
};

/** Dependencies an edit adds and removes. */
export type DependencyChange = { add: IssueId[]; remove: IssueId[] };

/** Puts the issue to rest as `rest`. Call inside the transaction that decides it, as an agent's start does: losing its agent then leaves it in Todo. */
export function restIssue(db: Db, coordinatorId: CoordinatorId, id: IssueId, rest: Rest): void {
  db().prepare("UPDATE issues SET rest = ? WHERE coordinator_id = ? AND id = ?").run(rest, coordinatorId, id);
}

export function issuesStore(db: Db) {
  function issues(coordinatorId: CoordinatorId, id: IssueId | null): Issue[] {
    return db().prepare(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE coordinator_id = ? AND (? IS NULL OR id = ?) ORDER BY rowid`).all(coordinatorId, id, id).map(toIssue);
  }

  return {
    issues: (coordinatorId: CoordinatorId): Issue[] => issues(coordinatorId, null),

    issue: (coordinatorId: CoordinatorId, id: IssueId): Issue | null => issues(coordinatorId, id)[0] ?? null,

    insertIssue(coordinatorId: CoordinatorId, issue: NewIssue, closes: Closes, at: number): { issue: Issue } | { refused: string } {
      return db().transaction(() => {
        const filed: Issue = { id: nextIssueId(db, coordinatorId), coordinatorId, ...issue, dependsOn: unique(issue.dependsOn), closed: null, createdAt: at };
        const problem = planProblem(issues(coordinatorId, null), filed, closes) ?? splitProblem(db, filed, null);
        if (problem !== null) return { refused: `${problem}.` };
        db()
          .prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, brief, done_criteria, verifier, rest, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(coordinatorId, filed.id, filed.kind, filed.title, filed.description, filed.brief, JSON.stringify(filed.doneCriteria), jsonOrNull(filed.verifier), filed.rest, filed.parentId, at);
        writeDependencies(db, filed, closes);
        return { issue: filed };
      })();
    },

    updateIssue(coordinatorId: CoordinatorId, id: IssueId, edit: IssueEdit, { requireUnheld, closes }: { requireUnheld: boolean; closes: Closes }): { issue: Issue } | { refused: string } {
      return db().transaction(() => {
        const now = issues(coordinatorId, id)[0];
        if (now === undefined) return { refused: `You have no issue ${id}.` };
        if (requireUnheld && db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ? AND ended_at IS NULL").get(coordinatorId, id) !== undefined) {
          return { refused: `An agent holds ${id}. Stop it with agent_stop first.` };
        }
        if (edit.kind !== undefined && edit.kind !== now.kind && db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ?").get(coordinatorId, id) !== undefined) {
          return { refused: `An agent has started on ${id}, so its kind stays ${now.kind}. File a new issue of the other kind instead.` };
        }
        const { dependsOn, decision, ...fields } = edit;
        const next: Issue = { ...now, ...fields, dependsOn: dependsOn === undefined ? now.dependsOn : changedDependencies(now.dependsOn, dependsOn) };
        const problem = verifierProblem(next.kind, next.verifier !== null);
        if (problem !== null) return { refused: `${id} can't be changed so: ${problem}. Give verifier: null with the change to drop the one named.` };
        const plan = planProblem(issues(coordinatorId, null), next, closes) ?? splitProblem(db, next, now);
        if (plan !== null) return { refused: `${plan}.` };
        db()
          .prepare("UPDATE issues SET kind = ?, title = ?, description = ?, brief = ?, done_criteria = ?, verifier = ?, rest = ?, closed_as = ?, closed_at = ?, parent_id = ? WHERE coordinator_id = ? AND id = ?")
          .run(next.kind, next.title, next.description, next.brief, JSON.stringify(next.doneCriteria), jsonOrNull(next.verifier), next.rest, next.closed?.as ?? null, next.closed?.at ?? null, next.parentId, coordinatorId, id);
        if (dependsOn !== undefined) writeDependencies(db, next, closes);
        if (decision !== undefined) db().prepare("INSERT INTO issue_decisions (coordinator_id, issue_id, text, at) VALUES (?, ?, ?, ?)").run(coordinatorId, id, decision.text, decision.at);
        return { issue: next };
      })();
    },

    recordedDecisions(coordinatorId: CoordinatorId, id: IssueId): RecordedDecision[] {
      return db()
        .prepare("SELECT text, at FROM issue_decisions WHERE coordinator_id = ? AND issue_id = ? ORDER BY id")
        .all(coordinatorId, id)
        .map((row) => ({ kind: "recorded" as const, ...recordedRowSchema.parse(row) }));
    },
  };
}

const recordedRowSchema = z.object({ text: z.string(), at: z.number().int() });

function nextIssueId(db: Db, coordinatorId: CoordinatorId): IssueId {
  const row = db()
    .prepare("SELECT issue_key AS key, (SELECT max(CAST(substr(id, instr(id, '-') + 1) AS INTEGER)) FROM issues WHERE coordinator_id = c.id) AS last FROM coordinators c WHERE id = ?")
    .get(coordinatorId);
  const { key, last } = nextIdRowSchema.parse(row);
  return issueIdOf(key, (last ?? 0) + 1);
}

const nextIdRowSchema = z.object({ key: issueKeySchema, last: z.number().nullable() });

function splitProblem(db: Db, issue: Pick<Issue, "coordinatorId" | "id" | "parentId">, was: Pick<Issue, "parentId"> | null): string | null {
  if (issue.parentId === null || issue.parentId === was?.parentId) return null;
  const row = db().prepare("SELECT id FROM agents WHERE coordinator_id = ? AND issue_id = ? AND ended_at IS NULL").get(issue.coordinatorId, issue.parentId);
  if (row === undefined) return null;
  const { id: holder } = z.object({ id: agentIdSchema }).parse(row);
  return `${issue.id} can't be a sub-issue of ${issue.parentId}: ${holder} holds ${issue.parentId}, and a parent has no agent, so ${issue.parentId} can't be split now. Stop ${holder} with agent_stop first`;
}

function writeDependencies(db: Db, { coordinatorId, id, dependsOn }: Pick<Issue, "coordinatorId" | "id" | "dependsOn">, closes: Closes): void {
  const rows = db().prepare("SELECT depends_on AS dependsOn, known_close AS close FROM issue_relations WHERE coordinator_id = ? AND issue_id = ?").all(coordinatorId, id);
  const kept = new Map(rows.map((row) => keptRowSchema.parse(row)).map(({ dependsOn: dependency, close }) => [dependency, close]));
  db().prepare("DELETE FROM issue_relations WHERE coordinator_id = ? AND issue_id = ?").run(coordinatorId, id);
  const insert = db().prepare("INSERT INTO issue_relations (coordinator_id, issue_id, depends_on, known_close) VALUES (?, ?, ?, ?)");
  for (const dependency of dependsOn) insert.run(coordinatorId, id, dependency, kept.has(dependency) ? kept.get(dependency) : knownClose(closes, dependency));
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

const changedDependencies = (dependsOn: readonly IssueId[], { add, remove }: DependencyChange): IssueId[] => unique([...dependsOn.filter((id) => !remove.includes(id)), ...add]);

const unique = (ids: readonly IssueId[]): IssueId[] => [...new Set(ids)];

const ISSUE_COLUMNS = `coordinator_id AS coordinatorId, id, kind, title, description, brief, done_criteria AS doneCriteria, verifier, rest, parent_id AS parentId,
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
  parentId: issueIdSchema.nullable(),
  dependsOn: json(z.array(issueIdSchema)),
  createdAt: z.number(),
});
const closedColumnsSchema = z.union([
  z.object({ closedAs: z.null(), closedAt: z.null() }).transform(() => null),
  z.object({ closedAs: closedAsSchema, closedAt: z.number() }).transform(({ closedAs, closedAt }) => ({ as: closedAs, at: closedAt })),
]);
const toIssue = (row: unknown): Issue => ({ ...issueRowSchema.parse(row), closed: closedColumnsSchema.parse(row) });

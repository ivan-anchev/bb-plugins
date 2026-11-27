// Issues: the regional manager's plan, with each one's parent and what it depends on. A write that
// a concurrent one could invalidate (numbering, "no agent holds it", the plan as a whole: plan.ts)
// decides and writes in one transaction. Rows are parsed into Issue here and nowhere else.
import { z } from "zod";
import { agentIdSchema } from "../../../model/agent/agent.ts";
import type { RecordedDecision } from "../../../model/decision.ts";
import { executionSchema } from "../../../model/agent/execution.ts";
import { issueKeySchema } from "../../../model/issue/key/issue-key.ts";
import { closedAsSchema, doneCriteriaSchema, issueIdOf, issueIdSchema, restSchema, verifierProblem, type Issue, type IssueId, type NewIssue, type Rest } from "../../../model/issue/issue.ts";
import { kindSchema } from "../../../model/issue/kind.ts";
import { planProblem } from "../../../model/issue/plan.ts";
import { knownClose, type CloseKey, type Closes, type KnownCloses } from "../../../model/issue/relations.ts";
import { planChanges } from "../../../model/feed/log-event.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../model/role.ts";
import type { CheckId } from "../../../model/verdict/check.ts";
import { appendLog } from "../feed/log-store.ts";
import { json, jsonOrNull, nullableJson, type Db } from "../rows.ts";

/**
 * A change to an issue's plan; a field left out stays as it is. Dependencies change by what is added
 * and removed, so two edits at once both apply. `decision`: one more recorded among its decisions.
 * `accept`: the issue's latest check of a done handoff, whose failed verdict the manager accepts as
 * it is (issues.ts statusEdit), written with the decision that says why.
 */
export type IssueEdit = Partial<Pick<Issue, "kind" | "title" | "description" | "brief" | "doneCriteria" | "verifier" | "reviewer" | "rest" | "closed" | "parentId">> & {
  dependsOn?: DependencyChange;
  decision?: Omit<RecordedDecision, "kind">;
  accept?: CheckId;
};

/**
 * The checks' part of an accept (checks-store.ts), handed to this store (store.ts) so that it
 * needn't import the checks' store, which imports it. Call each inside the edit's transaction.
 */
export type Acceptance = {
  /** Why the check can't be accepted now: it is no longer the issue's latest check of a done handoff, or it was accepted already; null when it can. Writes nothing. */
  refusal(coordinatorId: CoordinatorId, issueId: IssueId, checkId: CheckId): string | null;
  /** Stamps the check accepted at `at` and files the issue's follow-up with its unfixed findings (rounds/follow-up.ts); returns the follow-up's id. */
  accept(coordinatorId: CoordinatorId, issueId: IssueId, checkId: CheckId, at: number): IssueId;
};

/** Dependencies an edit adds and removes. */
export type DependencyChange = { add: IssueId[]; remove: IssueId[] };

/** Puts the issue to rest as `rest`. Call inside the transaction that decides it, as an agent's start does: losing its agent then leaves it in Todo. */
export function restIssue(db: Db, coordinatorId: CoordinatorId, id: IssueId, rest: Rest): void {
  db().prepare("UPDATE issues SET rest = ? WHERE coordinator_id = ? AND id = ?").run(rest, coordinatorId, id);
}

/**
 * Files an issue, numbered after the regional manager's highest, or says why the plan with it can't
 * stand (plan.ts) or its parent can't be split now, filing nothing. `closes`: every issue's close as
 * the read the filer is answered from says (see writeDependencies). Call inside a transaction: the
 * manager's issue_create, or a pass's settling, which files its follow-up (checks-store.ts).
 */
export function fileIssue(db: Db, coordinatorId: CoordinatorId, issue: NewIssue, closes: Closes, at: number): { issue: Issue } | { refused: string } {
  const filed: Issue = { id: nextIssueId(db, coordinatorId), coordinatorId, ...issue, dependsOn: unique(issue.dependsOn), closed: null, createdAt: at };
  const problem = planProblem(issuesOf(db, coordinatorId, null), filed, closes) ?? splitProblem(db, filed, null);
  if (problem !== null) return { refused: `${problem}.` };
  db()
    .prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, brief, done_criteria, verifier, reviewer, rest, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(coordinatorId, filed.id, filed.kind, filed.title, filed.description, filed.brief, JSON.stringify(filed.doneCriteria), jsonOrNull(filed.verifier), jsonOrNull(filed.reviewer), filed.rest, filed.parentId, at);
  writeDependencies(db, filed, closes);
  return { issue: filed };
}

/** The regional manager's issues, or only the one `id` names (null: every one), in the order filed. */
export function issuesOf(db: Db, coordinatorId: CoordinatorId, id: IssueId | null): Issue[] {
  return db().prepare(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE coordinator_id = ? AND (? IS NULL OR id = ?) ORDER BY rowid`).all(coordinatorId, id, id).map(toIssue);
}

export function issuesStore(db: Db, acceptance: Acceptance) {
  const issues = (coordinatorId: CoordinatorId, id: IssueId | null): Issue[] => issuesOf(db, coordinatorId, id);

  return {
    /** Every issue of the regional manager, in the order filed. */
    issues: (coordinatorId: CoordinatorId): Issue[] => issues(coordinatorId, null),

    /** One issue of the regional manager, or null when it has none by that id. */
    issue: (coordinatorId: CoordinatorId, id: IssueId): Issue | null => issues(coordinatorId, id)[0] ?? null,

    /** The manager's issue_create: files an issue (fileIssue) in its own transaction. */
    insertIssue: (coordinatorId: CoordinatorId, issue: NewIssue, closes: Closes, at: number): { issue: Issue } | { refused: string } => db().transaction(() => fileIssue(db, coordinatorId, issue, closes, at))(),

    /**
     * Applies the edit, or says why it can't. `requireUnheld`: refused while an agent holds the
     * issue. `closes`: every issue's close as the read the manager is answered from says (see
     * writeDependencies). Decided in the same transaction, so an agent starting meanwhile is seen:
     * the kind is fixed once any agent has started on the issue, the issue as it would be must stand
     * (verifierProblem), and so must the plan, among the issues as they are now (plan.ts), and a new
     * parent must be one no agent holds; an accept, of the check that is still the issue's latest
     * (Acceptance refusal). What it changed of the plan is logged at `at` (log-event.ts
     * planChanges), and an accept, after the edit's other writes: the store's one plan writer is
     * its one plan logger, so no edit goes unlogged and none is logged that didn't apply. An accept
     * then files its follow-up, last, so a failure there takes the whole edit back.
     */
    updateIssue(coordinatorId: CoordinatorId, id: IssueId, edit: IssueEdit, { requireUnheld, closes, at }: { requireUnheld: boolean; closes: Closes; at: number }): { issue: Issue } | { refused: string } {
      return db().transaction(() => {
        const now = issues(coordinatorId, id)[0];
        if (now === undefined) return { refused: `You have no issue ${id}.` };
        if (requireUnheld && db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ? AND ended_at IS NULL").get(coordinatorId, id) !== undefined) {
          return { refused: `An agent holds ${id}. Stop it with agent_stop first.` };
        }
        if (edit.kind !== undefined && edit.kind !== now.kind && db().prepare("SELECT 1 FROM agents WHERE coordinator_id = ? AND issue_id = ?").get(coordinatorId, id) !== undefined) {
          return { refused: `An agent has started on ${id}, so its kind stays ${now.kind}. File a new issue of the other kind instead.` };
        }
        const { dependsOn, decision, accept, ...fields } = edit;
        const next: Issue = { ...now, ...fields, dependsOn: dependsOn === undefined ? now.dependsOn : changedDependencies(now.dependsOn, dependsOn) };
        const problem = verifierProblem(next.kind, next.verifier !== null);
        if (problem !== null) return { refused: `${id} can't be changed so: ${problem}. Give verifier: null with the change to drop the one named.` };
        const plan = planProblem(issues(coordinatorId, null), next, closes) ?? splitProblem(db, next, now);
        if (plan !== null) return { refused: `${plan}.` };
        const stale = accept === undefined ? null : acceptance.refusal(coordinatorId, id, accept);
        if (stale !== null) return { refused: stale };
        db()
          .prepare("UPDATE issues SET kind = ?, title = ?, description = ?, brief = ?, done_criteria = ?, verifier = ?, reviewer = ?, rest = ?, closed_as = ?, closed_at = ?, parent_id = ? WHERE coordinator_id = ? AND id = ?")
          .run(next.kind, next.title, next.description, next.brief, JSON.stringify(next.doneCriteria), jsonOrNull(next.verifier), jsonOrNull(next.reviewer), next.rest, next.closed?.as ?? null, next.closed?.at ?? null, next.parentId, coordinatorId, id);
        if (dependsOn !== undefined) writeDependencies(db, next, closes);
        if (decision !== undefined) db().prepare("INSERT INTO issue_decisions (coordinator_id, issue_id, text, at) VALUES (?, ?, ?, ?)").run(coordinatorId, id, decision.text, decision.at);
        appendLog(db, coordinatorId, id, at, [...planChanges(now, next), ...(accept === undefined ? [] : [{ kind: "accepted" } as const])]);
        if (accept !== undefined) acceptance.accept(coordinatorId, id, accept, at);
        return { issue: next };
      })();
    },

    /** The decisions recorded on the issue, in the order recorded. */
    recordedDecisions(coordinatorId: CoordinatorId, id: IssueId): RecordedDecision[] {
      return db()
        .prepare("SELECT text, at FROM issue_decisions WHERE coordinator_id = ? AND issue_id = ? ORDER BY id")
        .all(coordinatorId, id)
        .map((row) => ({ kind: "recorded" as const, ...recordedRowSchema.parse(row) }));
    },
  };
}

const recordedRowSchema = z.object({ text: z.string(), at: z.number().int() });

/**
 * The id the regional manager's next issue is filed under: its issue key (migrations.ts issue_key),
 * numbered after its highest. why the highest, not a count: an id is never reused, whatever happens
 * to the issues before it. Call inside the transaction that files it.
 */
function nextIssueId(db: Db, coordinatorId: CoordinatorId): IssueId {
  const row = db()
    .prepare("SELECT issue_key AS key, (SELECT max(CAST(substr(id, instr(id, '-') + 1) AS INTEGER)) FROM issues WHERE coordinator_id = c.id) AS last FROM coordinators c WHERE id = ?")
    .get(coordinatorId);
  const { key, last } = nextIdRowSchema.parse(row);
  return issueIdOf(key, (last ?? 0) + 1);
}

const nextIdRowSchema = z.object({ key: issueKeySchema, last: z.number().nullable() });

/**
 * Why `issue` can't be a sub-issue of the parent it newly names (`was`: as stored; null: filed now):
 * an agent holds the parent, and a parent has no agent (brief, open question 2). Call inside the
 * transaction that writes it, so an agent starting meanwhile is seen.
 */
function splitProblem(db: Db, issue: Pick<Issue, "coordinatorId" | "id" | "parentId">, was: Pick<Issue, "parentId"> | null): string | null {
  if (issue.parentId === null || issue.parentId === was?.parentId) return null;
  const row = db().prepare("SELECT id FROM agents WHERE coordinator_id = ? AND issue_id = ? AND ended_at IS NULL").get(issue.coordinatorId, issue.parentId);
  if (row === undefined) return null;
  const { id: holder } = z.object({ id: agentIdSchema }).parse(row);
  return `${issue.id} can't be a sub-issue of ${issue.parentId}: ${holder} holds ${issue.parentId}, and a parent has no agent, so ${issue.parentId} can't be split now. Stop ${holder} with agent_stop first`;
}

/**
 * Writes the issue's dependencies as `dependsOn` lists them, in that order, over the relations it
 * has: a removed one's relation is deleted with the close known of it, a kept one keeps its own,
 * and an added one is written knowing its dependency's close as `closes` says, the read the manager
 * is answered from ("blocked by BBP-1"). So a dependency closed already then is no news, and any close
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

/** The dependencies with the change applied: the removed ones gone, the added ones after the rest. */
const changedDependencies = (dependsOn: readonly IssueId[], { add, remove }: DependencyChange): IssueId[] => unique([...dependsOn.filter((id) => !remove.includes(id)), ...add]);

const unique = (ids: readonly IssueId[]): IssueId[] => [...new Set(ids)];

// why a subquery: an issue is read with its dependencies, in the order they were written.
const ISSUE_COLUMNS = `coordinator_id AS coordinatorId, id, kind, title, description, brief, done_criteria AS doneCriteria, verifier, reviewer, rest, parent_id AS parentId,
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
  reviewer: nullableJson(executionSchema),
  rest: restSchema,
  parentId: issueIdSchema.nullable(),
  dependsOn: json(z.array(issueIdSchema)),
  createdAt: z.number(),
});
// why a union: how and when it was closed are written together, or not at all.
const closedColumnsSchema = z.union([
  z.object({ closedAs: z.null(), closedAt: z.null() }).transform(() => null),
  z.object({ closedAs: closedAsSchema, closedAt: z.number() }).transform(({ closedAs, closedAt }) => ({ as: closedAs, at: closedAt })),
]);
const toIssue = (row: unknown): Issue => ({ ...issueRowSchema.parse(row), closed: closedColumnsSchema.parse(row) });

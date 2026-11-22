// The plugin's SQLite, the authority on which thread holds which role. Every SQL statement lives
// under store/, and rows are parsed into model types there and nowhere else. This file opens the
// database, keeps the regional managers themselves, and composes the parts: issues, agents,
// checks, pull requests and the inbox.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { coordinatorSchema, notStartedSchema, type Coordinator, type NotStarted } from "../../contract.ts";
import type { NewProfile, Profile } from "../../model/profile/profile.ts";
import { memoryRevisionSchema, type MemoryFile, type MemoryRevision, type MemoryVersion } from "../../model/memory-file.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import { inboxStore } from "./inbox/inbox-store.ts";
import type { Agent, AgentId } from "../../model/agent/agent.ts";
import type { HandoffId } from "../../model/agent/handoff.ts";
import { issueDecisions, type IssueDecision } from "../../model/decision.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { IssueKey } from "../../model/issue/key/issue-key.ts";
import { agentsStore, bindRole, endAgent, insertAgent, insertTicket, type NewAgent } from "./issue/agents-store.ts";
import { checksStore, startCheck, startReview, supersedeChecks } from "./issue/checks-store.ts";
import { issueKeysStore } from "./issue/keys/issue-keys-store.ts";
import { issuesStore } from "./issue/issues-store.ts";
import { prStore } from "./issue/pr-store.ts";
import { MIGRATIONS } from "./migrations.ts";
import { lookFor, pictureIconManagers, withAvatar } from "./avatars.ts";

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), [...MIGRATIONS]);
  pictureIconManagers(db);

  function coordinators(id: CoordinatorId | null): Coordinator[] {
    return db()
      .prepare(
        `SELECT c.id, r.thread_id AS threadId, c.project_id AS projectId, c.description, c.avatar
           FROM coordinators c JOIN roles r ON r.ticket = c.ticket
          WHERE r.thread_id IS NOT NULL AND (? IS NULL OR c.id = ?)
          ORDER BY c.created_at DESC, c.rowid DESC`,
      )
      .all(id, id)
      .map(toCoordinator);
  }

  const inbox = inboxStore(db);
  const issues = issuesStore(db);

  return {
    ...inbox,
    ...issues,
    ...agentsStore(db),
    ...checksStore(db),
    ...prStore(db),
    ...issueKeysStore(db),

    /** The issue's decisions, its one list, oldest first: the questions put to the user naming it, answered or not, and the decisions recorded on it. */
    issueDecisions: (coordinatorId: CoordinatorId, id: IssueId): IssueDecision[] => issueDecisions(id, inbox.decisions(coordinatorId), issues.recordedDecisions(coordinatorId, id)),

    /**
     * A regional manager not started yet, with its profile and its unbound ticket, together or not at
     * all; an `auto` avatar picked against the looks stored, in the same transaction (lookFor).
     */
    insertCoordinator({ id, ticket, name, description, avatar, createdAt }: { id: CoordinatorId; ticket: string; createdAt: number } & NewProfile): void {
      db().transaction(() => {
        insertTicket(db, ticket, { kind: "coordinator", coordinatorId: id }, createdAt);
        db()
          .prepare("INSERT INTO coordinators (id, ticket, project_id, name, description, avatar, created_at) VALUES (?, ?, '', ?, ?, ?, ?)")
          .run(id, ticket, name, description, JSON.stringify(lookFor(db, avatar)), createdAt);
      })();
    },

    /**
     * Where the regional manager's start stands: started, with its thread; not started, with the
     * ticket and the name its thread is spawned with; or null: there is no such regional manager, or
     * it is one 0.3.0 left waiting for its goal, with no name, whose upgrade hasn't run yet (held-managers.ts).
     */
    startOf(id: CoordinatorId): { kind: "started"; threadId: string } | { kind: "not-started"; ticket: string; name: string } | null {
      const row = db().prepare("SELECT c.ticket, c.name, r.thread_id AS threadId FROM coordinators c JOIN roles r ON r.ticket = c.ticket WHERE c.id = ?").get(id);
      if (row === undefined) return null;
      const { ticket, name, threadId } = startRowSchema.parse(row);
      if (threadId !== null) return { kind: "started", threadId };
      return name === null ? null : { kind: "not-started", ticket, name };
    },

    /**
     * The project a regional manager not started yet starts on, and the issue key taken from its name
     * (issue-key.ts), written before its thread is spawned so its row is whole once the thread binds.
     */
    startsOn(id: CoordinatorId, projectId: string, issueKey: IssueKey): void {
      db().prepare("UPDATE coordinators SET project_id = ?, issue_key = ? WHERE id = ?").run(projectId, issueKey, id);
    },

    /** Replaces what the plugin keeps of the regional manager's profile but its name. */
    setProfile(id: CoordinatorId, { description, avatar }: Omit<Profile, "name">): void {
      db().prepare("UPDATE coordinators SET description = ?, avatar = ? WHERE id = ?").run(description, JSON.stringify(avatar), id);
    },

    /** Renames a regional manager not started yet; once started, its thread's title is its name. */
    rename(id: CoordinatorId, name: string): void {
      db().prepare("UPDATE coordinators SET name = ? WHERE id = ?").run(name, id);
    },

    /** The regional manager, once its thread is bound; null before. Every wake, poll, tool and board or memory read reaches it through here or coordinators, so none reaches one with no thread. */
    coordinator: (id: CoordinatorId): Coordinator | null => coordinators(id)[0] ?? null,

    /** Every regional manager whose thread is bound, newest first. */
    coordinators: (): Coordinator[] => coordinators(null),

    /** Every regional manager not started yet, newest first. */
    notStarted(): NotStarted[] {
      return db()
        .prepare(
          `SELECT c.id, c.name, c.description, c.avatar
             FROM coordinators c JOIN roles r ON r.ticket = c.ticket
            WHERE r.thread_id IS NULL AND c.name IS NOT NULL
            ORDER BY c.created_at DESC, c.rowid DESC`,
        )
        .all()
        .map((row) => withAvatar(notStartedRowSchema.parse(row)));
    },

    /**
     * Every regional manager the 0.3.0 upgrade looks at (held-managers.ts): each one 0.3.0 flagged as
     * waiting for its goal, with its thread or none, and each with a thread.
     */
    upgradeCandidates(): { id: CoordinatorId; ticket: string; threadId: string | null; flagged: boolean }[] {
      return db()
        .prepare("SELECT c.id, c.ticket, r.thread_id AS threadId, c.awaiting_goal AS flagged FROM coordinators c JOIN roles r ON r.ticket = c.ticket WHERE c.awaiting_goal = 1 OR r.thread_id IS NOT NULL")
        .all()
        .map((row) => candidateRowSchema.parse(row));
    },

    /** A 0.3.0 regional manager whose thread had its goal: it waits for nothing, and keeps its thread and role. */
    goalGiven(id: CoordinatorId): void {
      db().prepare("UPDATE coordinators SET awaiting_goal = 0 WHERE id = ?").run(id);
    },

    /**
     * Makes a 0.3.0 regional manager on `ticket` one not started yet, named `name`: that ticket gives
     * way to the new unbound `next`, so the thread it had, if any, never holds its role again.
     * Together or not at all; a second call, once the ticket gave way, changes nothing.
     */
    unhold(id: CoordinatorId, ticket: string, name: string, next: string, at: number): void {
      db().transaction(() => {
        if (db().prepare("SELECT 1 FROM coordinators WHERE id = ? AND ticket = ?").get(id, ticket) === undefined) return;
        insertTicket(db, next, { kind: "coordinator", coordinatorId: id }, at);
        db().prepare("UPDATE coordinators SET ticket = ?, name = ?, project_id = '', awaiting_goal = 0 WHERE id = ?").run(next, name, id);
        db().prepare("DELETE FROM roles WHERE ticket = ?").run(ticket);
      })();
    },

    /**
     * Gives the ticket's role to the thread, and returns that role. Idempotent: a ticket binds once,
     * so a second call, or a call naming another thread, changes nothing and returns null. An ended
     * agent's ticket never binds (see bindRole). A verifier's check, or a reviewer's review, starts
     * running in the thread as it binds, unless its check was superseded meanwhile.
     */
    bindTicket(ticket: string, threadId: string): Role | null {
      return db().transaction(() => {
        const role = bindRole(db, ticket, threadId);
        if (role?.kind === "verifier") startCheck(db, role.checkId, threadId);
        if (role?.kind === "reviewer") startReview(db, role.checkId, threadId);
        return role;
      })();
    },

    /**
     * The agent, holding its issue, and its unbound ticket (see insertAgent), superseding every check
     * of the issue still waiting, together: the new agent's work makes them moot. Null, with nothing
     * written, when an agent already holds the issue: two starts at once give one agent.
     */
    insertAgent(next: NewAgent): AgentId | null {
      return db().transaction(() => {
        const agentId = insertAgent(db, next);
        if (agentId !== null) supersedeChecks(db, next.coordinatorId, next.issueId);
        return agentId;
      })();
    },

    /**
     * A handover, together or not at all: ends the holder as replaced, leaving `left` (its current
     * handoff, or null), supersedes every check of the issue still waiting, and inserts the new
     * agent. Returns the new agent; null when the holder no longer holds its issue, and then nothing
     * is written. The handover stopped the issue's verifiers before.
     */
    replaceAgent(holder: Pick<Agent, "coordinatorId" | "id" | "issueId">, left: HandoffId | null, next: NewAgent): AgentId | null {
      return db().transaction(() => {
        // why placed: the issue passes to the new agent, so it neither rests in Todo nor tells the manager, who handed it over.
        if (!endAgent(db, holder, "replaced", left, true, next.at)) return null;
        supersedeChecks(db, holder.coordinatorId, holder.issueId);
        const agentId = insertAgent(db, next);
        // why throw, which rolls the transaction back: the holder ended just now in it, and an issue has one holder.
        if (agentId === null) throw new Error(`${next.issueId} of ${next.coordinatorId} has another holder than ${holder.id}.`);
        return agentId;
      })();
    },

    /**
     * Removes a regional manager whose thread bb deleted, or one not started yet the user deleted, and everything it owns, together. bb
     * deletes its agents and verifiers with it, so nothing it holds can be acted on, and a doorbell
     * to it would fail on every tick. why children first: the handle enforces foreign keys. why
     * fact_writes after the rest: deleting them counts writes there.
     */
    removeCoordinator(id: CoordinatorId): void {
      db().transaction(() => {
        for (const table of ["events", "doorbells", "reminders", "decisions", "pr_snapshots", "checks", "handoffs", "agents", "issue_relations", "issue_decisions", "issues", "memory_revisions", "fact_writes"]) {
          db().prepare(`DELETE FROM ${table} WHERE coordinator_id = ?`).run(id);
        }
        db().prepare("DELETE FROM coordinators WHERE id = ?").run(id);
        db().prepare("DELETE FROM roles WHERE json_extract(role, '$.coordinatorId') = ?").run(id);
      })();
    },

    /** How many times the regional manager's issue facts were written (migrations.ts fact_writes): every write a status can follow moves it as it commits. */
    factWrites(id: CoordinatorId): number {
      const row = db().prepare("SELECT writes FROM fact_writes WHERE coordinator_id = ?").get(id);
      return row === undefined ? 0 : z.object({ writes: z.number().int() }).parse(row).writes;
    },

    /**
     * The file's revision, now that it reads as `version`: the same while it stays that version, one
     * more each time it is seen at another. why one statement: no other read can see the old
     * revision with the new version, so two sightings of one version always share a revision.
     */
    memoryRevision(id: CoordinatorId, file: MemoryFile, version: MemoryVersion): MemoryRevision {
      const row = db()
        .prepare(
          `INSERT INTO memory_revisions (coordinator_id, file, version, revision) VALUES (?, ?, ?, 1)
             ON CONFLICT (coordinator_id, file) DO UPDATE
             SET revision = revision + (version IS NOT excluded.version), version = excluded.version
           RETURNING revision`,
        )
        .get(id, file, version);
      return z.object({ revision: memoryRevisionSchema }).parse(row).revision;
    },
  };
}

const toCoordinator = (row: unknown): Coordinator => withAvatar(coordinatorSchema.extend({ avatar: z.string() }).parse(row));
const notStartedRowSchema = notStartedSchema.extend({ avatar: z.string() });
const startRowSchema = z.object({ ticket: z.string(), name: z.string().nullable(), threadId: z.string().nullable() });
const candidateRowSchema = z.object({ id: coordinatorSchema.shape.id, ticket: z.string(), threadId: z.string().nullable(), flagged: z.number().transform((flag) => flag === 1) });

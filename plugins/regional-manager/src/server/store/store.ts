// The plugin's SQLite, the authority on which thread holds which role. Every SQL statement lives
// under store/, and rows are parsed into model types there and nowhere else. This file opens the
// database, keeps the regional managers themselves, and composes the parts: issues, agents,
// checks, pull requests and the inbox.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { coordinatorSchema, type Coordinator } from "../../contract.ts";
import { avatarSchema, DEFAULT_AVATAR, type Profile } from "../../model/profile.ts";
import { memoryRevisionSchema, type MemoryFile, type MemoryRevision, type MemoryVersion } from "../../model/memory-file.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import { inboxStore } from "./inbox/inbox-store.ts";
import type { Agent, AgentId } from "../../model/agent.ts";
import type { HandoffId } from "../../model/handoff.ts";
import { agentsStore, bindRole, endAgent, insertAgent, insertTicket, type NewAgent } from "./issue/agents-store.ts";
import { checksStore, startCheck, supersedeChecks } from "./issue/checks-store.ts";
import { issuesStore } from "./issue/issues-store.ts";
import { prStore } from "./issue/pr-store.ts";
import { MIGRATIONS } from "./migrations.ts";

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), [...MIGRATIONS]);

  function coordinators(id: CoordinatorId | null): Coordinator[] {
    return db()
      .prepare(
        `SELECT c.id, r.thread_id AS threadId, c.project_id AS projectId, c.verify, c.description, c.avatar, c.created_at AS createdAt
           FROM coordinators c JOIN roles r ON r.ticket = c.ticket
          WHERE r.thread_id IS NOT NULL AND (? IS NULL OR c.id = ?)
          ORDER BY c.created_at DESC, c.rowid DESC`,
      )
      .all(id, id)
      .map(toCoordinator);
  }

  return {
    ...inboxStore(db),
    ...issuesStore(db),
    ...agentsStore(db),
    ...checksStore(db),
    ...prStore(db),

    /** The regional manager and its unbound ticket, together or not at all. */
    insertCoordinator({ id, ticket, projectId, verify, description, avatar, createdAt }: { id: CoordinatorId; ticket: string; projectId: string; verify: boolean; createdAt: number } & KeptProfile): void {
      db().transaction(() => {
        insertTicket(db, ticket, { kind: "coordinator", coordinatorId: id }, createdAt);
        db()
          .prepare("INSERT INTO coordinators (id, ticket, project_id, verify, description, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(id, ticket, projectId, Number(verify), description, JSON.stringify(avatar), createdAt);
      })();
    },

    /** Replaces what the plugin keeps of the regional manager's profile. */
    setProfile(id: CoordinatorId, { description, avatar }: KeptProfile): void {
      db().prepare("UPDATE coordinators SET description = ?, avatar = ? WHERE id = ?").run(description, JSON.stringify(avatar), id);
    },

    /** Whether a regional manager with this id was ever started. */
    isCoordinator(id: CoordinatorId): boolean {
      return db().prepare("SELECT 1 FROM coordinators WHERE id = ?").get(id) !== undefined;
    },

    /** The regional manager, once its thread is bound. */
    coordinator: (id: CoordinatorId): Coordinator | null => coordinators(id)[0] ?? null,

    /** Every regional manager whose thread is bound, newest first. */
    coordinators: (): Coordinator[] => coordinators(null),

    /**
     * Gives the ticket's role to the thread, and returns that role. Idempotent: a ticket binds once,
     * so a second call, or a call naming another thread, changes nothing and returns null. An ended
     * agent's ticket never binds (see bindRole). A verifier's check starts running in the thread as
     * it binds, unless it was superseded meanwhile.
     */
    bindTicket(ticket: string, threadId: string): Role | null {
      return db().transaction(() => {
        const role = bindRole(db, ticket, threadId);
        if (role?.kind === "verifier") startCheck(db, role.checkId, threadId);
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
     * Removes a regional manager whose thread bb deleted, and everything it owns, together. bb
     * deletes its agents and verifiers with it, so nothing it holds can be acted on, and a doorbell
     * to it would fail on every tick. why children first: the handle enforces foreign keys. why
     * fact_writes after the rest: deleting them counts writes there.
     */
    removeCoordinator(id: CoordinatorId): void {
      db().transaction(() => {
        for (const table of ["events", "doorbells", "reminders", "decisions", "pr_snapshots", "checks", "handoffs", "agents", "issue_relations", "issues", "memory_revisions", "fact_writes"]) {
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

/** What the store keeps of a profile: all of it but the name, which is the thread's title. */
type KeptProfile = Omit<Profile, "name">;

// why: SQLite has no boolean; verify is stored as 0 or 1. The avatar is stored as JSON, and one
// this release can't draw, as an icon a later release dropped from its picker, reads as the
// default rather than hiding every regional manager from the list.
const coordinatorRowSchema = coordinatorSchema.extend({
  verify: z.number().transform((verify) => verify === 1),
  avatar: z.string().transform((json) => avatarSchema.catch(DEFAULT_AVATAR).parse(JSON.parse(json))),
});
const toCoordinator = (row: unknown): Coordinator => coordinatorRowSchema.parse(row);

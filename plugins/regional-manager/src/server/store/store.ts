import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { coordinatorSchema, notStartedSchema, type Coordinator, type NotStarted } from "../../contract.ts";
import { avatarSchema, DEFAULT_AVATAR, type Profile } from "../../model/profile.ts";
import { memoryRevisionSchema, type MemoryFile, type MemoryRevision, type MemoryVersion } from "../../model/memory-file.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import { inboxStore } from "./inbox/inbox-store.ts";
import type { Agent, AgentId } from "../../model/agent.ts";
import type { HandoffId } from "../../model/handoff.ts";
import { issueDecisions, type IssueDecision } from "../../model/decision.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { IssueKey } from "../../model/issue/key/issue-key.ts";
import { agentsStore, bindRole, endAgent, insertAgent, insertTicket, type NewAgent } from "./issue/agents-store.ts";
import { checksStore, startCheck, supersedeChecks } from "./issue/checks-store.ts";
import { issueKeysStore } from "./issue/keys/issue-keys-store.ts";
import { issuesStore } from "./issue/issues-store.ts";
import { prStore } from "./issue/pr-store.ts";
import { MIGRATIONS } from "./migrations.ts";

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  const db = () => storage.database();
  storage.migrate(db(), [...MIGRATIONS]);

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

    issueDecisions: (coordinatorId: CoordinatorId, id: IssueId): IssueDecision[] => issueDecisions(id, inbox.decisions(coordinatorId), issues.recordedDecisions(coordinatorId, id)),

    insertCoordinator({ id, ticket, name, description, avatar, createdAt }: { id: CoordinatorId; ticket: string; createdAt: number } & Profile): void {
      db().transaction(() => {
        insertTicket(db, ticket, { kind: "coordinator", coordinatorId: id }, createdAt);
        db()
          .prepare("INSERT INTO coordinators (id, ticket, project_id, name, description, avatar, created_at) VALUES (?, ?, '', ?, ?, ?, ?)")
          .run(id, ticket, name, description, JSON.stringify(avatar), createdAt);
      })();
    },

    startOf(id: CoordinatorId): { kind: "started"; threadId: string } | { kind: "not-started"; ticket: string; name: string } | null {
      const row = db().prepare("SELECT c.ticket, c.name, r.thread_id AS threadId FROM coordinators c JOIN roles r ON r.ticket = c.ticket WHERE c.id = ?").get(id);
      if (row === undefined) return null;
      const { ticket, name, threadId } = startRowSchema.parse(row);
      if (threadId !== null) return { kind: "started", threadId };
      return name === null ? null : { kind: "not-started", ticket, name };
    },

    startsOn(id: CoordinatorId, projectId: string, issueKey: IssueKey): void {
      db().prepare("UPDATE coordinators SET project_id = ?, issue_key = ? WHERE id = ?").run(projectId, issueKey, id);
    },

    setProfile(id: CoordinatorId, { description, avatar }: Omit<Profile, "name">): void {
      db().prepare("UPDATE coordinators SET description = ?, avatar = ? WHERE id = ?").run(description, JSON.stringify(avatar), id);
    },

    rename(id: CoordinatorId, name: string): void {
      db().prepare("UPDATE coordinators SET name = ? WHERE id = ?").run(name, id);
    },

    coordinator: (id: CoordinatorId): Coordinator | null => coordinators(id)[0] ?? null,

    coordinators: (): Coordinator[] => coordinators(null),

    notStarted(): NotStarted[] {
      return db()
        .prepare(
          `SELECT c.id, c.name, c.description, c.avatar
             FROM coordinators c JOIN roles r ON r.ticket = c.ticket
            WHERE r.thread_id IS NULL AND c.name IS NOT NULL
            ORDER BY c.created_at DESC, c.rowid DESC`,
        )
        .all()
        .map((row) => notStartedRowSchema.parse(row));
    },

    upgradeCandidates(): { id: CoordinatorId; ticket: string; threadId: string | null; flagged: boolean }[] {
      return db()
        .prepare("SELECT c.id, c.ticket, r.thread_id AS threadId, c.awaiting_goal AS flagged FROM coordinators c JOIN roles r ON r.ticket = c.ticket WHERE c.awaiting_goal = 1 OR r.thread_id IS NOT NULL")
        .all()
        .map((row) => candidateRowSchema.parse(row));
    },

    goalGiven(id: CoordinatorId): void {
      db().prepare("UPDATE coordinators SET awaiting_goal = 0 WHERE id = ?").run(id);
    },

    unhold(id: CoordinatorId, ticket: string, name: string, next: string, at: number): void {
      db().transaction(() => {
        if (db().prepare("SELECT 1 FROM coordinators WHERE id = ? AND ticket = ?").get(id, ticket) === undefined) return;
        insertTicket(db, next, { kind: "coordinator", coordinatorId: id }, at);
        db().prepare("UPDATE coordinators SET ticket = ?, name = ?, project_id = '', awaiting_goal = 0 WHERE id = ?").run(next, name, id);
        db().prepare("DELETE FROM roles WHERE ticket = ?").run(ticket);
      })();
    },

    bindTicket(ticket: string, threadId: string): Role | null {
      return db().transaction(() => {
        const role = bindRole(db, ticket, threadId);
        if (role?.kind === "verifier") startCheck(db, role.checkId, threadId);
        return role;
      })();
    },

    insertAgent(next: NewAgent): AgentId | null {
      return db().transaction(() => {
        const agentId = insertAgent(db, next);
        if (agentId !== null) supersedeChecks(db, next.coordinatorId, next.issueId);
        return agentId;
      })();
    },

    replaceAgent(holder: Pick<Agent, "coordinatorId" | "id" | "issueId">, left: HandoffId | null, next: NewAgent): AgentId | null {
      return db().transaction(() => {
        if (!endAgent(db, holder, "replaced", left, true, next.at)) return null;
        supersedeChecks(db, holder.coordinatorId, holder.issueId);
        const agentId = insertAgent(db, next);
        if (agentId === null) throw new Error(`${next.issueId} of ${next.coordinatorId} has another holder than ${holder.id}.`);
        return agentId;
      })();
    },

    removeCoordinator(id: CoordinatorId): void {
      db().transaction(() => {
        for (const table of ["events", "doorbells", "reminders", "decisions", "pr_snapshots", "checks", "handoffs", "agents", "issue_relations", "issue_decisions", "issues", "memory_revisions", "fact_writes"]) {
          db().prepare(`DELETE FROM ${table} WHERE coordinator_id = ?`).run(id);
        }
        db().prepare("DELETE FROM coordinators WHERE id = ?").run(id);
        db().prepare("DELETE FROM roles WHERE json_extract(role, '$.coordinatorId') = ?").run(id);
      })();
    },

    factWrites(id: CoordinatorId): number {
      const row = db().prepare("SELECT writes FROM fact_writes WHERE coordinator_id = ?").get(id);
      return row === undefined ? 0 : z.object({ writes: z.number().int() }).parse(row).writes;
    },

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

const storedAvatarSchema = z.string().transform((json) => avatarSchema.catch(DEFAULT_AVATAR).parse(JSON.parse(json)));
const toCoordinator = (row: unknown): Coordinator => coordinatorSchema.extend({ avatar: storedAvatarSchema }).parse(row);
const notStartedRowSchema = notStartedSchema.extend({ avatar: storedAvatarSchema });
const startRowSchema = z.object({ ticket: z.string(), name: z.string().nullable(), threadId: z.string().nullable() });
const candidateRowSchema = z.object({ id: coordinatorSchema.shape.id, ticket: z.string(), threadId: z.string().nullable(), flagged: z.number().transform((flag) => flag === 1) });

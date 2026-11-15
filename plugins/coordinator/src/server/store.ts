// The plugin's SQLite, the authority on which thread holds which role. Every SQL statement lives
// here, and rows are parsed into model types here and nowhere else.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { coordinatorSchema, type Coordinator } from "../contract.ts";
import { roleSchema, type CoordinatorId, type Role } from "../model/role.ts";

// Append-only: bb.storage.migrate records each statement's hash by its index.
const MIGRATIONS = [
  // A ticket is minted before its thread is spawned, and the thread's metadata carries it until
  // bb answers with the thread's id. why JSON: a role is read and written whole, never queried inside.
  `CREATE TABLE roles (ticket TEXT PRIMARY KEY, thread_id TEXT UNIQUE, role TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // A coordinating thread's memory folder is named by its id; its thread is its ticket's.
  `CREATE TABLE coordinators (id TEXT PRIMARY KEY, ticket TEXT NOT NULL UNIQUE REFERENCES roles (ticket),
     project_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  function roleOfThread(threadId: string): Role | null {
    const row = db().prepare("SELECT role FROM roles WHERE thread_id = ?").get(threadId);
    return row === undefined ? null : toRole(row);
  }

  return {
    /** The coordinator and its unbound ticket, together or not at all. */
    insertCoordinator({ id, ticket, projectId, createdAt }: { id: CoordinatorId; ticket: string; projectId: string; createdAt: number }): void {
      const role: Role = { kind: "coordinator", coordinatorId: id };
      db().transaction(() => {
        db().prepare("INSERT INTO roles (ticket, role, created_at) VALUES (?, ?, ?)").run(ticket, JSON.stringify(role), createdAt);
        db().prepare("INSERT INTO coordinators (id, ticket, project_id, created_at) VALUES (?, ?, ?, ?)").run(id, ticket, projectId, createdAt);
      })();
    },

    /**
     * Gives the ticket's role to the thread. Idempotent: a ticket binds once, so a second call, or a
     * call naming another thread, changes nothing. Returns whether this call bound it.
     */
    bindTicket(ticket: string, threadId: string): boolean {
      return db().prepare("UPDATE roles SET thread_id = ? WHERE ticket = ? AND thread_id IS NULL").run(threadId, ticket).changes === 1;
    },

    /** What tools see: a thread has a role only once its ticket is bound to it. */
    roleOfThread,

    /**
     * What a session gets: the thread's bound role, else the role of the unbound ticket it carries.
     * why the ticket: a first session can start before bb's spawn answer binds it. A ticket already
     * bound belongs to its own thread, so a copy in another thread's metadata grants nothing.
     */
    roleFor(threadId: string, ticket: string | null): Role | null {
      const bound = roleOfThread(threadId);
      if (bound !== null || ticket === null) return bound;
      const row = db().prepare("SELECT role FROM roles WHERE ticket = ? AND thread_id IS NULL").get(ticket);
      return row === undefined ? null : toRole(row);
    },

    /** Every coordinator whose thread is bound, newest first. */
    coordinators(): Coordinator[] {
      return db()
        .prepare(
          `SELECT c.id, r.thread_id AS threadId, c.project_id AS projectId, c.created_at AS createdAt
             FROM coordinators c JOIN roles r ON r.ticket = c.ticket
            WHERE r.thread_id IS NOT NULL
            ORDER BY c.created_at DESC, c.rowid DESC`,
        )
        .all()
        .map((row) => coordinatorSchema.parse(row));
    },
  };
}

const toRole = (row: unknown): Role => roleSchema.parse(JSON.parse(z.object({ role: z.string() }).parse(row).role));

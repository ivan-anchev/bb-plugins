// The plugin's SQLite, the authority on which thread holds which role. Every SQL statement lives
// here, and rows are parsed into model types here and nowhere else.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { coordinatorSchema, type Coordinator } from "../contract.ts";
import { closedKindSchema, doneCriteriaSchema, executionSchema, placementSchema, type ClosedKind, type Crew, type DraftEdit, type Placement } from "../model/crew.ts";
import { memoryRevisionSchema, type MemoryFile, type MemoryRevision, type MemoryVersion } from "../model/memory-file.ts";
import { coordinatorIdSchema, crewIdSchema, roleSchema, type CoordinatorId, type CrewId, type Role } from "../model/role.ts";

// Append-only: bb.storage.migrate records each statement's hash by its index.
const MIGRATIONS = [
  // A ticket is minted before its thread is spawned, and the thread's metadata carries it until
  // bb answers with the thread's id. why JSON: a role is read and written whole, never queried inside.
  `CREATE TABLE roles (ticket TEXT PRIMARY KEY, thread_id TEXT UNIQUE, role TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // A coordinating thread's memory folder is named by its id; its thread is its ticket's.
  `CREATE TABLE coordinators (id TEXT PRIMARY KEY, ticket TEXT NOT NULL UNIQUE REFERENCES roles (ticket),
     project_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // Each memory file's revision, and the version it was last seen at. A file with no row is seen
  // for the first time; `version` is null while it doesn't exist.
  `CREATE TABLE memory_revisions (coordinator_id TEXT NOT NULL, file TEXT NOT NULL, version TEXT,
     revision INTEGER NOT NULL, PRIMARY KEY (coordinator_id, file))`,
  // A crew of a coordinating thread, numbered c1, c2… within it. Its thread is its ticket's; a
  // crew whose ticket is unbound (or that has none) never got a thread. why JSON: the criteria and
  // placement are read and written whole.
  `CREATE TABLE crews (coordinator_id TEXT NOT NULL REFERENCES coordinators (id), id TEXT NOT NULL,
     ticket TEXT UNIQUE REFERENCES roles (ticket), title TEXT NOT NULL, brief TEXT NOT NULL,
     done_criteria TEXT NOT NULL, placement TEXT NOT NULL, created_at INTEGER NOT NULL,
     closed_as TEXT, closed_at INTEGER, PRIMARY KEY (coordinator_id, id))`,
  // The model the user picked for a draft in bb's composer; null for the project's default.
  `ALTER TABLE crews ADD COLUMN execution TEXT`,
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

  function crews(coordinatorId: CoordinatorId, crewId: CrewId | null): Crew[] {
    return db()
      .prepare(
        `SELECT k.coordinator_id AS coordinatorId, k.id, k.title, k.brief, k.done_criteria AS doneCriteria, k.placement, k.execution,
                k.created_at AS createdAt, k.closed_as AS closedAs, k.closed_at AS closedAt, r.thread_id AS threadId
           FROM crews k LEFT JOIN roles r ON r.ticket = k.ticket
          WHERE k.coordinator_id = ? AND (? IS NULL OR k.id = ?)
          ORDER BY k.created_at, k.rowid`,
      )
      .all(coordinatorId, crewId, crewId)
      .map(toCrew);
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
     * The crew and its unbound ticket, together or not at all, numbered after the coordinating
     * thread's last crew. why one transaction: two starts at once can't take the same number.
     */
    insertCrew(crew: { coordinatorId: CoordinatorId; ticket: string; title: string; brief: string; doneCriteria: string[]; placement: Placement; createdAt: number }): CrewId {
      return db().transaction(() => {
        const { count } = z.object({ count: z.number() }).parse(db().prepare("SELECT count(*) AS count FROM crews WHERE coordinator_id = ?").get(crew.coordinatorId));
        const id = crewIdSchema.parse(`c${count + 1}`);
        const role: Role = { kind: "crew", coordinatorId: crew.coordinatorId, crewId: id };
        db().prepare("INSERT INTO roles (ticket, role, created_at) VALUES (?, ?, ?)").run(crew.ticket, JSON.stringify(role), crew.createdAt);
        db()
          .prepare("INSERT INTO crews (coordinator_id, id, ticket, title, brief, done_criteria, placement, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(crew.coordinatorId, id, crew.ticket, crew.title, crew.brief, JSON.stringify(crew.doneCriteria), JSON.stringify(crew.placement), crew.createdAt);
        return id;
      })();
    },

    /**
     * Gives the ticket's role to the thread, and returns that role. Idempotent: a ticket binds once,
     * so a second call, or a call naming another thread, changes nothing and returns null.
     */
    bindTicket(ticket: string, threadId: string): Role | null {
      const row = db().prepare("UPDATE roles SET thread_id = ? WHERE ticket = ? AND thread_id IS NULL RETURNING role").get(threadId, ticket);
      return row === undefined ? null : toRole(row);
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

    /** Whether a coordinating thread with this id was ever started. */
    isCoordinator(id: CoordinatorId): boolean {
      return db().prepare("SELECT 1 FROM coordinators WHERE id = ?").get(id) !== undefined;
    },

    /** The coordinating thread, once its thread is bound. */
    coordinator(id: CoordinatorId): Coordinator | null {
      const row = db()
        .prepare(
          `SELECT c.id, r.thread_id AS threadId, c.project_id AS projectId, c.created_at AS createdAt
             FROM coordinators c JOIN roles r ON r.ticket = c.ticket
            WHERE c.id = ? AND r.thread_id IS NOT NULL`,
        )
        .get(id);
      return row === undefined ? null : coordinatorSchema.parse(row);
    },

    /** Every crew of the coordinating thread, in the order they were started. */
    crews: (coordinatorId: CoordinatorId): Crew[] => crews(coordinatorId, null),

    /** One crew of the coordinating thread, or null when it has no crew by that id. */
    crew: (coordinatorId: CoordinatorId, crewId: CrewId): Crew | null => crews(coordinatorId, crewId)[0] ?? null,

    /** The ticket a crew's thread is spawned with. why throw: every crew is inserted with one. */
    crewTicket(coordinatorId: CoordinatorId, crewId: CrewId): string {
      const row = db().prepare("SELECT ticket FROM crews WHERE coordinator_id = ? AND id = ?").get(coordinatorId, crewId);
      return z.object({ ticket: z.string() }).parse(row).ticket;
    },

    /** Replaces a draft's brief, criteria, model and placement. */
    updateDraft(coordinatorId: CoordinatorId, crewId: CrewId, edit: DraftEdit): void {
      db()
        .prepare("UPDATE crews SET brief = ?, done_criteria = ?, execution = ?, placement = ? WHERE coordinator_id = ? AND id = ?")
        .run(edit.brief, JSON.stringify(edit.doneCriteria), JSON.stringify(edit.execution), JSON.stringify(edit.placement), coordinatorId, crewId);
    },

    /** Records how a crew was closed. A crew closes once: closing it again changes nothing. */
    closeCrew(coordinatorId: CoordinatorId, crewId: CrewId, kind: ClosedKind, at: number): void {
      db().prepare("UPDATE crews SET closed_as = ?, closed_at = ? WHERE coordinator_id = ? AND id = ? AND closed_as IS NULL").run(kind, at, coordinatorId, crewId);
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

const crewRowSchema = z.object({
  coordinatorId: coordinatorIdSchema,
  id: crewIdSchema,
  title: z.string(),
  brief: z.string(),
  doneCriteria: z.string().transform((json) => doneCriteriaSchema.parse(JSON.parse(json))),
  placement: z.string().transform((json) => placementSchema.parse(JSON.parse(json))),
  execution: z
    .string()
    .nullable()
    .transform((json) => (json === null ? null : executionSchema.parse(JSON.parse(json)))),
  createdAt: z.number(),
  closedAs: closedKindSchema.nullable(),
  closedAt: z.number().nullable(),
  threadId: z.string().nullable(),
});

function toCrew(row: unknown): Crew {
  const { closedAs, closedAt, threadId, ...crew } = crewRowSchema.parse(row);
  return {
    ...crew,
    launch: threadId === null ? { kind: "draft" } : { kind: "started", threadId },
    closed: closedAs === null || closedAt === null ? null : { kind: closedAs, at: closedAt },
  };
}

// The plugin's SQLite, the authority on which thread holds which role. Every SQL statement lives
// here, and rows are parsed into model types here and nowhere else.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { coordinatorSchema, type Coordinator } from "../contract.ts";
import { closedKindSchema, doneCriteriaSchema, executionSchema, placementSchema, type ClosedKind, type Crew, type DraftEdit, type Placement } from "../model/crew.ts";
import { handoffIdSchema, handoffReportSchema, verdictSchema, type Handoff, type HandoffId } from "../model/handoff.ts";
import { inboxEventSchema, type InboxEvent, type StoredEvent } from "../model/inbox/inbox-event.ts";
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
  // The model the user picked for a draft in bb's composer; null for the coordinating thread's.
  `ALTER TABLE crews ADD COLUMN execution TEXT`,
  // A crew's handoff, as it wrote it (why JSON: read and written whole), and the turn it was made in.
  `CREATE TABLE handoffs (id TEXT PRIMARY KEY, coordinator_id TEXT NOT NULL, crew_id TEXT NOT NULL, report TEXT NOT NULL,
     turn_seq INTEGER NOT NULL, at INTEGER NOT NULL, FOREIGN KEY (coordinator_id, crew_id) REFERENCES crews (coordinator_id, id))`,
  // A done handoff's verdict, written with it. why JSON: each state carries its own fields.
  `CREATE TABLE verdicts (handoff_id TEXT PRIMARY KEY REFERENCES handoffs (id), verdict TEXT NOT NULL)`,
  // Everything the plugin tells a coordinating thread about, in the order recorded. A doorbell
  // announced it once `announced_at` is set; crew_catch_up returned it once `read_at` is.
  `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     event TEXT NOT NULL, at INTEGER NOT NULL, announced_at INTEGER, read_at INTEGER)`,
  `CREATE INDEX events_unread ON events (coordinator_id) WHERE read_at IS NULL`,
  // A doorbell bb queued and hasn't dispatched yet. While one is queued, no other is sent.
  `CREATE TABLE doorbells (coordinator_id TEXT PRIMARY KEY REFERENCES coordinators (id), queued_message_id TEXT NOT NULL UNIQUE)`,
  // A crew's latest handoff is read on every board read and idle: newest by rowid within the crew.
  `CREATE INDEX handoffs_of_crew ON handoffs (coordinator_id, crew_id)`,
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

  function insertEvent(coordinatorId: CoordinatorId, event: InboxEvent, at: number): void {
    db().prepare("INSERT INTO events (coordinator_id, event, at) VALUES (?, ?, ?)").run(coordinatorId, JSON.stringify(event), at);
  }

  /** The first handoff the clause picks, or null when it picks none. */
  function oneHandoff(clause: string, ...params: string[]): Handoff | null {
    const row = db()
      .prepare(
        `SELECT h.id, h.coordinator_id AS coordinatorId, h.crew_id AS crewId, h.report, h.turn_seq AS turnSeq, h.at, v.verdict
           FROM handoffs h LEFT JOIN verdicts v ON v.handoff_id = h.id
          ${clause}
          LIMIT 1`,
      )
      .get(...params);
    return row === undefined ? null : toHandoff(row);
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

    /**
     * A crew's handoff, its verdict when it claims done, and the event announcing it, together or
     * not at all: a handoff can't exist unannounced, or a done one without its verdict.
     */
    insertHandoff(handoff: Handoff): void {
      const { id, coordinatorId, crewId, at, turnSeq, ...report } = handoff;
      db().transaction(() => {
        const stored = handoffReportSchema.parse(report);
        db().prepare("INSERT INTO handoffs (id, coordinator_id, crew_id, report, turn_seq, at) VALUES (?, ?, ?, ?, ?, ?)").run(id, coordinatorId, crewId, JSON.stringify(stored), turnSeq, at);
        if (handoff.status === "done") db().prepare("INSERT INTO verdicts (handoff_id, verdict) VALUES (?, ?)").run(id, JSON.stringify(handoff.verdict));
        insertEvent(coordinatorId, { kind: "handoff", crewId, handoffId: id, status: handoff.status }, at);
      })();
    },

    /** One handoff, or null when there is none by that id. */
    handoff: (id: HandoffId): Handoff | null => oneHandoff("WHERE h.id = ?", id),

    /** A crew's latest handoff, or null when it has made none. */
    latestHandoff: (coordinatorId: CoordinatorId, crewId: CrewId): Handoff | null =>
      oneHandoff("WHERE h.coordinator_id = ? AND h.crew_id = ? ORDER BY h.rowid DESC", coordinatorId, crewId),

    /** Records something to tell the coordinating thread, neither announced nor read yet. */
    insertEvent,

    /** The events no doorbell has announced and no catch-up has returned, in the order recorded. */
    unannounced(coordinatorId: CoordinatorId): StoredEvent[] {
      return db().prepare("SELECT id, at, event FROM events WHERE coordinator_id = ? AND announced_at IS NULL AND read_at IS NULL ORDER BY id").all(coordinatorId).map(toEvent);
    },

    /** Every coordinating thread with an event to announce. */
    coordinatorsToRing(): CoordinatorId[] {
      return db()
        .prepare("SELECT DISTINCT coordinator_id AS id FROM events WHERE announced_at IS NULL AND read_at IS NULL")
        .all()
        .map((row) => z.object({ id: coordinatorIdSchema }).parse(row).id);
    },

    /**
     * Marks the events announced by a doorbell, and keeps the doorbell when bb queued it rather than
     * sending it (null: sent), together.
     */
    announce(coordinatorId: CoordinatorId, eventIds: number[], queuedMessageId: string | null, at: number): void {
      db().transaction(() => {
        const mark = db().prepare("UPDATE events SET announced_at = ? WHERE id = ?");
        for (const eventId of eventIds) mark.run(at, eventId);
        if (queuedMessageId !== null) db().prepare("INSERT INTO doorbells (coordinator_id, queued_message_id) VALUES (?, ?)").run(coordinatorId, queuedMessageId);
      })();
    },

    /** Every unread event, marked read as it is returned, in the order recorded. */
    takeUnread(coordinatorId: CoordinatorId, at: number): StoredEvent[] {
      return db()
        .prepare("UPDATE events SET read_at = ? WHERE coordinator_id = ? AND read_at IS NULL RETURNING id, at, event")
        .all(at, coordinatorId)
        .map(toEvent)
        .sort((a, b) => a.id - b.id);
    },

    /** The queued doorbell of a coordinating thread, or null when none is waiting. */
    doorbell(coordinatorId: CoordinatorId): string | null {
      const row = db().prepare("SELECT queued_message_id AS id FROM doorbells WHERE coordinator_id = ?").get(coordinatorId);
      return row === undefined ? null : z.object({ id: z.string() }).parse(row).id;
    },

    /** Every queued doorbell, with the thread it waits in. */
    doorbells(): { coordinatorId: CoordinatorId; threadId: string; queuedMessageId: string }[] {
      return db()
        .prepare(
          `SELECT d.coordinator_id AS coordinatorId, r.thread_id AS threadId, d.queued_message_id AS queuedMessageId
             FROM doorbells d JOIN coordinators c ON c.id = d.coordinator_id JOIN roles r ON r.ticket = c.ticket`,
        )
        .all()
        .map((row) => z.object({ coordinatorId: coordinatorIdSchema, threadId: z.string(), queuedMessageId: z.string() }).parse(row));
    },

    /** Forgets the queued doorbell with this message id, and returns whose it was (null: no doorbell has it). */
    clearDoorbell(queuedMessageId: string): CoordinatorId | null {
      const row = db().prepare("DELETE FROM doorbells WHERE queued_message_id = ? RETURNING coordinator_id AS id").get(queuedMessageId);
      return row === undefined ? null : z.object({ id: coordinatorIdSchema }).parse(row).id;
    },

    /**
     * Forgets a doorbell that never reached its thread, and makes every unread event of its
     * coordinating thread unannounced again, together, so the next doorbell names them.
     */
    reopenDoorbell(queuedMessageId: string): void {
      db().transaction(() => {
        const row = db().prepare("DELETE FROM doorbells WHERE queued_message_id = ? RETURNING coordinator_id AS id").get(queuedMessageId);
        if (row === undefined) return;
        const { id } = z.object({ id: coordinatorIdSchema }).parse(row);
        db().prepare("UPDATE events SET announced_at = NULL WHERE coordinator_id = ? AND read_at IS NULL").run(id);
      })();
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

const handoffRowSchema = z.object({
  id: handoffIdSchema,
  coordinatorId: coordinatorIdSchema,
  crewId: crewIdSchema,
  report: z.string().transform((json) => handoffReportSchema.parse(JSON.parse(json))),
  turnSeq: z.number().int(),
  at: z.number(),
  verdict: z
    .string()
    .nullable()
    .transform((json) => (json === null ? null : verdictSchema.parse(JSON.parse(json)))),
});

function toHandoff(row: unknown): Handoff {
  const { report, verdict, ...handoff } = handoffRowSchema.parse(row);
  if (report.status !== "done") return { ...handoff, ...report };
  // why throw: a done handoff is inserted with its verdict, in one transaction.
  if (verdict === null) throw new Error(`The done handoff ${handoff.id} has no verdict`);
  return { ...handoff, ...report, verdict };
}

const eventRowSchema = z.object({ id: z.number().int(), at: z.number(), event: z.string().transform((json) => inboxEventSchema.parse(JSON.parse(json))) });
const toEvent = (row: unknown): StoredEvent => eventRowSchema.parse(row);

function toCrew(row: unknown): Crew {
  const { closedAs, closedAt, threadId, ...crew } = crewRowSchema.parse(row);
  return {
    ...crew,
    launch: threadId === null ? { kind: "draft" } : { kind: "started", threadId },
    closed: closedAs === null || closedAt === null ? null : { kind: closedAs, at: closedAt },
  };
}

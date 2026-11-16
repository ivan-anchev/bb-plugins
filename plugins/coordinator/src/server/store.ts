// The plugin's SQLite, the authority on which thread holds which role. Every SQL statement lives
// here, and rows are parsed into model types here and nowhere else.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { coordinatorSchema, type Coordinator } from "../contract.ts";
import { closedKindSchema, doneCriteriaSchema, executionSchema, placementSchema, type ClosedKind, type Crew, type DraftEdit } from "../model/crew.ts";
import { decisionIdSchema, type Decision, type DecisionId } from "../model/decision.ts";
import { handoffIdSchema, handoffReportSchema, type Handoff, type HandoffId, type NewHandoff } from "../model/handoff.ts";
import { inboxEventSchema, type InboxEvent, type StoredEvent } from "../model/inbox/inbox-event.ts";
import { ownTreeEventAfter, type OwnTreeEvent } from "../model/inbox/own-tree.ts";
import { memoryRevisionSchema, type MemoryFile, type MemoryRevision, type MemoryVersion } from "../model/memory-file.ts";
import { nextDue, reminderIdSchema, type Reminder, type ReminderId } from "../model/reminder.ts";
import { meaningfulChanges, prSnapshotSchema, prUnavailableSchema, type CiVerdict, type PrSnapshot, type PrStatus, type PrUnavailable } from "../model/verdict/pr.ts";
import { coordinatorIdSchema, crewIdSchema, roleSchema, type CoordinatorId, type CrewId, type Role } from "../model/role.ts";
import { isSettled, verdictSchema, type Verdict } from "../model/verdict/verdict.ts";

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
  // Whether a done handoff gets a verifier: set at creation and on the board, read when a crew hands off.
  `ALTER TABLE coordinators ADD COLUMN verify INTEGER NOT NULL DEFAULT 1`,
  // The tick reads every verdict still waiting for its verifier, or for its verdict.
  `CREATE INDEX verdicts_open ON verdicts (handoff_id) WHERE json_extract(verdict, '$.state') IN ('queued', 'running')`,
  // How many failed verdicts went back to the crew to fix. why on the crew: its rounds are spent once, whatever it hands off next.
  `ALTER TABLE crews ADD COLUMN fix_rounds INTEGER NOT NULL DEFAULT 0`,
  // The tick settles every returned verdict nobody has been told of yet (see the verdict's settlement).
  `CREATE INDEX verdicts_unsettled ON verdicts (handoff_id) WHERE json_extract(verdict, '$.settlement.kind') IN ('pending', 'sending-back')`,
  // A crew's pull request as the latest read that found one returned it (null: none has), with
  // when a read first saw its head commit, when this one was read, and the crew's latest handoff
  // as it began, all written by that read alone; and, of every read, why the latest failed and
  // whether that lasts (null: it didn't), and when one was last tried. why JSON: read and written whole.
  `CREATE TABLE pr_snapshots (coordinator_id TEXT NOT NULL, crew_id TEXT NOT NULL, snapshot TEXT, head_seen_at INTEGER, read_at INTEGER, handoff_at_read TEXT,
     unavailable TEXT, polled_at INTEGER NOT NULL, PRIMARY KEY (coordinator_id, crew_id), FOREIGN KEY (coordinator_id, crew_id) REFERENCES crews (coordinator_id, id))`,
  // The tick settles verdicts that wait for CI as well.
  `DROP INDEX verdicts_unsettled`,
  `CREATE INDEX verdicts_unsettled ON verdicts (handoff_id) WHERE json_extract(verdict, '$.settlement.kind') IN ('pending', 'sending-back', 'waiting-for-ci')`,
  // A reminder a coordinating thread set: its note, when it is next due, and how often it repeats
  // (null: once). why AUTOINCREMENT: a cancelled or spent id is never reused, so cancelling by an
  // old id can't take a newer reminder.
  `CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     note TEXT NOT NULL, due_at INTEGER NOT NULL, every_ms INTEGER)`,
  // The tick reads every reminder that is due; crew_catch_up lists a coordinating thread's.
  `CREATE INDEX reminders_due ON reminders (due_at)`,
  `CREATE INDEX reminders_of_coordinator ON reminders (coordinator_id)`,
  // A decision a coordinating thread put to the user: its question, its options (why JSON: read and
  // written whole), when it asked, and the user's answer and when they gave it (null: not yet).
  // why AUTOINCREMENT: an id is never reused, so an answer can't land on a newer decision.
  `CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, coordinator_id TEXT NOT NULL REFERENCES coordinators (id),
     question TEXT NOT NULL, options TEXT NOT NULL, asked_at INTEGER NOT NULL, answer TEXT, answered_at INTEGER)`,
  // The board, the panel's badge and crew_catch_up read a coordinating thread's decisions.
  `CREATE INDEX decisions_of_coordinator ON decisions (coordinator_id)`,
  // Every end of a coordinating thread's turn reads its latest event about its own working tree, and so does its board.
  `CREATE INDEX events_own_tree ON events (coordinator_id, id) WHERE json_extract(event, '$.kind') IN ('coordinator-edited-files', 'coordinator-tree-clean')`,
];

/** Where a verdict must still be for a change to apply: queued, or running in this verifier thread. */
export type VerdictFrom = { state: "queued" } | { state: "running"; verifierThreadId: string };

type Returned = Extract<Verdict, { state: "returned" }>;

/**
 * How a returned verdict ends, or that it waits: `waiting-for-ci`, it passed every criterion and
 * waits for CI on its commit; `checked`, final and its coordinating thread's, with bb's refusal
 * of its findings if they were refused and what CI said; `sent-back`, its findings reached the
 * crew for the fix round it claimed; `maybe-sent-back`, its coordinating thread's, with that round
 * kept, as nothing shows whether they did. The last two keep the CI their claim recorded.
 */
export type Settlement = Extract<Returned["settlement"], { kind: "checked" | "waiting-for-ci" }> | { kind: "sent-back" } | { kind: "maybe-sent-back" };

/** A crew's PR status, and when the watch last tried to read it. */
type PolledPr = PrStatus & { polledAt: number };

/** A verdict that is still waiting, with whose handoff it is. */
type OpenVerdict = { handoffId: HandoffId; coordinatorId: CoordinatorId; crewId: CrewId; verdict: Extract<Verdict, { state: VerdictFrom["state"] }> };

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
                k.fix_rounds AS fixRounds, k.created_at AS createdAt, k.closed_as AS closedAs, k.closed_at AS closedAt, r.thread_id AS threadId
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

  /** The latest event about the coordinating thread's own working tree, with when it was recorded; null when none was. */
  function lastOwnTreeEvent(coordinatorId: CoordinatorId): { at: number; event: OwnTreeEvent } | null {
    const row = db()
      .prepare(
        `SELECT id, at, event FROM events
          WHERE coordinator_id = ? AND json_extract(event, '$.kind') IN ('coordinator-edited-files', 'coordinator-tree-clean')
          ORDER BY id DESC LIMIT 1`,
      )
      .get(coordinatorId);
    if (row === undefined) return null;
    const { at, event } = toEvent(row);
    // why throw: the clause picks only these kinds.
    if (event.kind !== "coordinator-edited-files" && event.kind !== "coordinator-tree-clean") throw new Error(`The event ${event.kind} is not about the working tree`);
    return { at, event };
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

  function verifies(id: CoordinatorId): boolean {
    return z.object({ verify: z.number() }).parse(db().prepare("SELECT verify FROM coordinators WHERE id = ?").get(id)).verify === 1;
  }

  function insertTicket(ticket: string, role: Role, createdAt: number): void {
    db().prepare("INSERT INTO roles (ticket, role, created_at) VALUES (?, ?, ?)").run(ticket, JSON.stringify(role), createdAt);
  }

  function verdictOf(handoffId: HandoffId): Verdict | null {
    const row = db().prepare("SELECT verdict FROM verdicts WHERE handoff_id = ?").get(handoffId);
    return row === undefined ? null : verdictSchema.parse(JSON.parse(z.object({ verdict: z.string() }).parse(row).verdict));
  }

  function writeVerdict(handoffId: HandoffId, verdict: Verdict): void {
    db().prepare("UPDATE verdicts SET verdict = ? WHERE handoff_id = ?").run(JSON.stringify(verdict), handoffId);
  }

  /** Replaces the verdict if it is still where `from` says, and says whether it did. Call inside a transaction. */
  function moveVerdict(handoffId: HandoffId, from: VerdictFrom, next: Verdict): boolean {
    const current = verdictOf(handoffId);
    if (current === null || !isAt(current, from)) return false;
    writeVerdict(handoffId, next);
    return true;
  }

  /** Whose handoff it is. why throw: a verdict is inserted with its handoff. */
  function ownerOf(handoffId: HandoffId): { coordinatorId: CoordinatorId; crewId: CrewId } {
    const row = db().prepare("SELECT coordinator_id AS coordinatorId, crew_id AS crewId FROM handoffs WHERE id = ?").get(handoffId);
    return z.object({ coordinatorId: coordinatorIdSchema, crewId: crewIdSchema }).parse(row);
  }

  /** Counts one more fix round on the crew (`by` 1), or gives one back (-1), and returns the count. Call inside a transaction. */
  function countFixRound(coordinatorId: CoordinatorId, crewId: CrewId, by: 1 | -1): number {
    const row = db().prepare("UPDATE crews SET fix_rounds = fix_rounds + ? WHERE coordinator_id = ? AND id = ? RETURNING fix_rounds AS rounds").get(by, coordinatorId, crewId);
    return z.object({ rounds: z.number().int() }).parse(row).rounds;
  }

  /** The handoff's verdict if a verifier returned it and it is not settled yet, else null. */
  function unsettled(handoffId: HandoffId): Returned | null {
    const verdict = verdictOf(handoffId);
    return verdict?.state === "returned" && !isSettled(verdict) ? verdict : null;
  }

  /** The crew's verdicts that passed every criterion and wait for CI on their commit, oldest first. */
  function waitingForCi(coordinatorId: CoordinatorId, crewId: CrewId): HandoffId[] {
    return db()
      .prepare(
        `SELECT h.id AS handoffId FROM handoffs h JOIN verdicts v ON v.handoff_id = h.id
          WHERE h.coordinator_id = ? AND h.crew_id = ? AND json_extract(v.verdict, '$.settlement.kind') = 'waiting-for-ci'
          ORDER BY h.rowid`,
      )
      .all(coordinatorId, crewId)
      .map((row) => z.object({ handoffId: handoffIdSchema }).parse(row).handoffId);
  }

  /**
   * Marks every verdict of the crew's earlier handoffs that is still waiting, for its verifier or
   * for CI, as superseded, and returns the verifier threads that were checking them. Call inside a
   * transaction.
   */
  function supersede(coordinatorId: CoordinatorId, crewId: CrewId): string[] {
    const open = db()
      .prepare(
        `SELECT v.handoff_id AS handoffId, h.coordinator_id AS coordinatorId, h.crew_id AS crewId, v.verdict
           FROM verdicts v JOIN handoffs h ON h.id = v.handoff_id
          WHERE h.coordinator_id = ? AND h.crew_id = ? AND json_extract(v.verdict, '$.state') IN ('queued', 'running')`,
      )
      .all(coordinatorId, crewId)
      .map(toOpenVerdict);
    const mark = db().prepare("UPDATE verdicts SET verdict = ? WHERE handoff_id = ?");
    for (const handoffId of [...open.map((verdict) => verdict.handoffId), ...waitingForCi(coordinatorId, crewId)]) mark.run(JSON.stringify({ state: "superseded" } satisfies Verdict), handoffId);
    return open.flatMap(({ verdict }) => (verdict.state === "running" ? [verdict.verifierThreadId] : []));
  }

  function prStatus(coordinatorId: CoordinatorId, crewId: CrewId): PolledPr | null {
    const row = db()
      .prepare(
        `SELECT snapshot, head_seen_at AS headSeenAt, read_at AS readAt, handoff_at_read AS handoffAtRead, unavailable, polled_at AS polledAt
           FROM pr_snapshots WHERE coordinator_id = ? AND crew_id = ?`,
      )
      .get(coordinatorId, crewId);
    return row === undefined ? null : prStatusRowSchema.parse(row);
  }

  /** Records that a read of the crew's pull request was tried, and why it failed (null: it didn't). */
  function markPolled(coordinatorId: CoordinatorId, crewId: CrewId, unavailable: PrUnavailable | null, at: number): void {
    db()
      .prepare(
        `INSERT INTO pr_snapshots (coordinator_id, crew_id, unavailable, polled_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (coordinator_id, crew_id) DO UPDATE SET unavailable = excluded.unavailable, polled_at = excluded.polled_at`,
      )
      .run(coordinatorId, crewId, unavailable === null ? null : JSON.stringify(unavailable), at);
  }

  return {
    /** The coordinator and its unbound ticket, together or not at all. */
    insertCoordinator({ id, ticket, projectId, verify, createdAt }: { id: CoordinatorId; ticket: string; projectId: string; verify: boolean; createdAt: number }): void {
      db().transaction(() => {
        insertTicket(ticket, { kind: "coordinator", coordinatorId: id }, createdAt);
        db().prepare("INSERT INTO coordinators (id, ticket, project_id, verify, created_at) VALUES (?, ?, ?, ?, ?)").run(id, ticket, projectId, Number(verify), createdAt);
      })();
    },

    /**
     * Turns verification of the coordinating thread's done handoffs on or off, and records the
     * change for it, together. Setting what is already set changes and records nothing; returns
     * whether it changed.
     */
    setVerify(id: CoordinatorId, verify: boolean, at: number): boolean {
      return db().transaction(() => {
        const changed = db().prepare("UPDATE coordinators SET verify = ? WHERE id = ? AND verify != ?").run(Number(verify), id, Number(verify)).changes > 0;
        if (changed) insertEvent(id, { kind: "verification-toggled", verify }, at);
        return changed;
      })();
    },

    lastOwnTreeEvent,

    /**
     * Records what a read of `fileCount` changed files in the coordinating thread's own working tree
     * says that its latest such event doesn't (see ownTreeEventAfter), deciding from that event in the
     * same transaction. Returns whether it recorded one.
     */
    recordOwnTree(id: CoordinatorId, fileCount: number, at: number): boolean {
      return db().transaction(() => {
        const event = ownTreeEventAfter(lastOwnTreeEvent(id)?.event ?? null, fileCount);
        if (event !== null) insertEvent(id, event, at);
        return event !== null;
      })();
    },

    /** Whether the coordinating thread's done handoffs get a verifier from now on. why throw: callers check the id first. */
    verifies,

    /** A verifier's unbound ticket, minted before its thread is spawned. */
    insertVerifierTicket(ticket: string, role: Extract<Role, { kind: "verifier" }>, createdAt: number): void {
      insertTicket(ticket, role, createdAt);
    },

    /**
     * The crew and its unbound ticket, together or not at all, numbered after the coordinating
     * thread's last crew. why one transaction: two starts at once can't take the same number.
     */
    insertCrew(crew: Pick<Crew, "coordinatorId" | "title" | "brief" | "doneCriteria" | "placement" | "execution" | "createdAt"> & { ticket: string }): CrewId {
      return db().transaction(() => {
        const { count } = z.object({ count: z.number() }).parse(db().prepare("SELECT count(*) AS count FROM crews WHERE coordinator_id = ?").get(crew.coordinatorId));
        const id = crewIdSchema.parse(`c${count + 1}`);
        insertTicket(crew.ticket, { kind: "crew", coordinatorId: crew.coordinatorId, crewId: id }, crew.createdAt);
        db()
          .prepare("INSERT INTO crews (coordinator_id, id, ticket, title, brief, done_criteria, placement, execution, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(crew.coordinatorId, id, crew.ticket, crew.title, crew.brief, JSON.stringify(crew.doneCriteria), JSON.stringify(crew.placement), crew.execution === null ? null : JSON.stringify(crew.execution), crew.createdAt);
        return id;
      })();
    },

    /**
     * Gives the ticket's role to the thread, and returns that role. Idempotent: a ticket binds once,
     * so a second call, or a call naming another thread, changes nothing and returns null. A
     * verifier's verdict starts running in the thread as it binds, unless it was superseded meanwhile.
     */
    bindTicket(ticket: string, threadId: string): Role | null {
      return db().transaction(() => {
        const row = db().prepare("UPDATE roles SET thread_id = ? WHERE ticket = ? AND thread_id IS NULL RETURNING role").get(threadId, ticket);
        if (row === undefined) return null;
        const role = toRole(row);
        if (role.kind === "verifier") moveVerdict(role.handoffId, { state: "queued" }, { state: "running", verifierThreadId: threadId, nudged: false });
        return role;
      })();
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
          `SELECT c.id, r.thread_id AS threadId, c.project_id AS projectId, c.verify, c.created_at AS createdAt
             FROM coordinators c JOIN roles r ON r.ticket = c.ticket
            WHERE c.id = ? AND r.thread_id IS NOT NULL`,
        )
        .get(id);
      return row === undefined ? null : toCoordinator(row);
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
     * A crew's handoff and, when it claims done, its verdict, together or not at all. A blocked or
     * gave-up handoff is announced at once. A done one is queued for a verifier when its
     * coordinating thread verifies, and announced with its verdict later; else it is waived and
     * announced at once. A done one supersedes every earlier verdict of the crew still waiting.
     * Returns its verdict (null: not done) and the verifier threads of the verdicts it superseded.
     */
    insertHandoff(handoff: NewHandoff): { verdict: Verdict | null; superseded: string[] } {
      const { id, coordinatorId, crewId, at, turnSeq, ...report } = handoff;
      return db().transaction(() => {
        const stored = handoffReportSchema.parse(report);
        db().prepare("INSERT INTO handoffs (id, coordinator_id, crew_id, report, turn_seq, at) VALUES (?, ?, ?, ?, ?, ?)").run(id, coordinatorId, crewId, JSON.stringify(stored), turnSeq, at);
        if (stored.status !== "done") {
          insertEvent(coordinatorId, { kind: "handoff", crewId, handoffId: id, status: stored.status }, at);
          return { verdict: null, superseded: [] };
        }
        const superseded = supersede(coordinatorId, crewId);
        const verdict: Verdict = verifies(coordinatorId) ? { state: "queued" } : { state: "waived" };
        db().prepare("INSERT INTO verdicts (handoff_id, verdict) VALUES (?, ?)").run(id, JSON.stringify(verdict));
        if (verdict.state === "waived") insertEvent(coordinatorId, { kind: "checked", crewId, handoffId: id }, at);
        return { verdict, superseded };
      })();
    },

    /** Every verdict waiting for its verifier to start or to return, oldest first. */
    openVerdicts(): OpenVerdict[] {
      return db()
        .prepare(
          `SELECT v.handoff_id AS handoffId, h.coordinator_id AS coordinatorId, h.crew_id AS crewId, v.verdict
             FROM verdicts v JOIN handoffs h ON h.id = v.handoff_id
            WHERE json_extract(v.verdict, '$.state') IN ('queued', 'running')
            ORDER BY h.rowid`,
        )
        .all()
        .map(toOpenVerdict);
    },

    /** Marks a running verdict's verifier as nudged, once; says whether this call did. */
    markNudged(handoffId: HandoffId, verifierThreadId: string): boolean {
      return db().transaction(() => {
        const current = verdictOf(handoffId);
        if (current?.state !== "running" || current.verifierThreadId !== verifierThreadId || current.nudged) return false;
        return moveVerdict(handoffId, { state: "running", verifierThreadId }, { ...current, nudged: true });
      })();
    },

    /**
     * Gives up on a waiting verdict and records it checked for its coordinating thread, together, if
     * it is still where `from` says; returns whose it was, or null when it had moved on.
     */
    giveUpVerdict(handoffId: HandoffId, from: VerdictFrom, verdict: Extract<Verdict, { state: "could-not-run" }>, at: number): CoordinatorId | null {
      return db().transaction(() => {
        if (!moveVerdict(handoffId, from, verdict)) return null;
        const { coordinatorId, crewId } = ownerOf(handoffId);
        insertEvent(coordinatorId, { kind: "checked", crewId, handoffId }, at);
        return coordinatorId;
      })();
    },

    /**
     * Stores a verifier's verdict, not yet settled, if its verifier is still the handoff's running
     * one; says whether it was. Nobody is told until it is settled.
     */
    receiveVerdict(handoffId: HandoffId, verdict: Omit<Returned, "settlement">): boolean {
      return db().transaction(() => moveVerdict(handoffId, { state: "running", verifierThreadId: verdict.verifierThreadId }, { ...verdict, settlement: { kind: "pending" } }))();
    },

    /**
     * Claims the crew's next fix round for a pending verdict, or one that waited for CI, before its
     * findings are sent: counts it on the crew and marks the verdict as going back, with what CI
     * said, together.
     */
    claimFixRound(handoffId: HandoffId, ci: CiVerdict): void {
      db().transaction(() => {
        const verdict = unsettled(handoffId);
        // why throw: it is claimed right after it was read pending or waiting, with no await between.
        if (verdict === null || verdict.settlement.kind === "sending-back") throw new Error(`The verdict on ${handoffId} is not pending, so it has no round to claim.`);
        const { coordinatorId, crewId } = ownerOf(handoffId);
        writeVerdict(handoffId, { ...verdict, settlement: { kind: "sending-back", round: countFixRound(coordinatorId, crewId, 1), ci } });
      })();
    },

    /**
     * Settles an unsettled verdict and records it for its coordinating thread, together. `sent-back`
     * and `maybe-sent-back` need a claimed round, and keep it and its CI; `checked` gives back a
     * round claimed for findings that never left. `waiting-for-ci` moves a pending verdict to wait,
     * and records nothing: nobody is told until it settles. Returns whose it was, or null when it
     * was already settled or waiting, or there is no claim to keep.
     */
    settleReturned(handoffId: HandoffId, as: Settlement, at: number): CoordinatorId | null {
      return db().transaction(() => {
        const verdict = unsettled(handoffId);
        if (verdict === null) return null;
        const { settlement } = verdict;
        const { coordinatorId, crewId } = ownerOf(handoffId);
        if (as.kind === "waiting-for-ci") {
          if (settlement.kind !== "pending") return null;
          writeVerdict(handoffId, { ...verdict, settlement: as });
          return coordinatorId;
        }
        if (as.kind === "checked") {
          if (settlement.kind === "sending-back") countFixRound(coordinatorId, crewId, -1);
          writeVerdict(handoffId, { ...verdict, settlement: as });
          insertEvent(coordinatorId, { kind: "checked", crewId, handoffId }, at);
          return coordinatorId;
        }
        if (settlement.kind !== "sending-back") return null;
        const { round, ci } = settlement;
        writeVerdict(handoffId, { ...verdict, settlement: { kind: as.kind, round, ci } });
        insertEvent(coordinatorId, as.kind === "sent-back" ? { kind: "sent-back", crewId, handoffId, round } : { kind: "checked", crewId, handoffId }, at);
        return coordinatorId;
      })();
    },

    waitingForCi,

    /** Every returned verdict not settled yet, oldest first: one waiting for CI, or one a crash or a reload stopped settling. */
    unsettledVerdicts(): HandoffId[] {
      return db()
        .prepare(
          `SELECT v.handoff_id AS handoffId FROM verdicts v JOIN handoffs h ON h.id = v.handoff_id
            WHERE json_extract(v.verdict, '$.settlement.kind') IN ('pending', 'sending-back', 'waiting-for-ci')
            ORDER BY h.rowid`,
        )
        .all()
        .map((row) => z.object({ handoffId: handoffIdSchema }).parse(row).handoffId);
    },

    /** The crew's latest verdict a verifier returned, or null when none has. */
    latestReturnedVerdict(coordinatorId: CoordinatorId, crewId: CrewId): Extract<Verdict, { state: "returned" }> | null {
      const handoff = oneHandoff("WHERE h.coordinator_id = ? AND h.crew_id = ? AND json_extract(v.verdict, '$.state') = 'returned' ORDER BY h.rowid DESC", coordinatorId, crewId);
      if (handoff === null) return null;
      // why throw: the clause picks only done handoffs with a returned verdict.
      if (handoff.status !== "done" || handoff.verdict.state !== "returned") throw new Error(`The handoff ${handoff.id} has no returned verdict`);
      return handoff.verdict;
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

    /** What the watch knows of the crew's pull request, or null before it first tried to read it. */
    prStatus,

    /**
     * Saves a successful read of the crew's pull request, begun when the crew's latest handoff was
     * `handoffAtRead`. One that found it saves its snapshot as read now, with when a read first saw
     * its head commit and that handoff, and records a `pr` event for its coordinating thread when
     * it changed meaningfully, together. One that found none (null) keeps the snapshot already
     * saved as it was read, and vouches for nothing about it.
     */
    savePrRead(coordinatorId: CoordinatorId, crewId: CrewId, pr: PrSnapshot | null, handoffAtRead: HandoffId | null, at: number): void {
      return db().transaction(() => {
        const before = prStatus(coordinatorId, crewId);
        markPolled(coordinatorId, crewId, null, at);
        if (pr === null) return;
        const headSeenAt = before !== null && before.snapshot !== null && before.snapshot.headSha === pr.headSha ? before.headSeenAt : at;
        db()
          .prepare(
            `UPDATE pr_snapshots SET snapshot = ?, head_seen_at = ?, read_at = ?, handoff_at_read = ?
              WHERE coordinator_id = ? AND crew_id = ?`,
          )
          .run(JSON.stringify(pr), headSeenAt, at, handoffAtRead, coordinatorId, crewId);
        const changes = meaningfulChanges(before?.snapshot ?? null, pr);
        if (changes.length > 0) insertEvent(coordinatorId, { kind: "pr", crewId, pr, changes }, at);
      })();
    },

    /** Records why reading the crew's pull request failed, and whether that lasts. The snapshot it had stays as it was read, and nothing is recorded for its coordinating thread. */
    markPrUnavailable(coordinatorId: CoordinatorId, crewId: CrewId, unavailable: PrUnavailable, at: number): void {
      markPolled(coordinatorId, crewId, unavailable, at);
    },

    /** Sets a reminder for the coordinating thread, and returns it with its id. */
    insertReminder(coordinatorId: CoordinatorId, { note, dueAt, everyMs }: Omit<Reminder, "id">): Reminder {
      const row = db().prepare("INSERT INTO reminders (coordinator_id, note, due_at, every_ms) VALUES (?, ?, ?, ?) RETURNING id, note, due_at AS dueAt, every_ms AS everyMs").get(coordinatorId, note, dueAt, everyMs);
      return toReminder(row);
    },

    /** The coordinating thread's reminders, soonest due first. */
    reminders(coordinatorId: CoordinatorId): Reminder[] {
      return db().prepare("SELECT id, note, due_at AS dueAt, every_ms AS everyMs FROM reminders WHERE coordinator_id = ? ORDER BY due_at, id").all(coordinatorId).map(toReminder);
    },

    /** Cancels one of the coordinating thread's reminders, and returns it (null: it has none by that id). */
    cancelReminder(coordinatorId: CoordinatorId, id: ReminderId): Reminder | null {
      const row = db().prepare("DELETE FROM reminders WHERE id = ? AND coordinator_id = ? RETURNING id, note, due_at AS dueAt, every_ms AS everyMs").get(rowIdOf(id), coordinatorId);
      return row === undefined ? null : toReminder(row);
    },

    /** Every reminder due at `now`, with its coordinating thread and that thread's id. */
    dueReminders(now: number): { id: ReminderId; coordinatorId: CoordinatorId; threadId: string }[] {
      return db()
        .prepare(
          `SELECT m.id, m.coordinator_id AS coordinatorId, r.thread_id AS threadId
             FROM reminders m JOIN coordinators c ON c.id = m.coordinator_id JOIN roles r ON r.ticket = c.ticket
            WHERE m.due_at <= ? AND r.thread_id IS NOT NULL
            ORDER BY m.due_at, m.id`,
        )
        .all(now)
        .map((row) => z.object({ id: reminderRowIdSchema, coordinatorId: coordinatorIdSchema, threadId: z.string() }).parse(row));
    },

    /** Deletes every reminder of the coordinating thread, due or not. */
    deleteReminders(coordinatorId: CoordinatorId): void {
      db().prepare("DELETE FROM reminders WHERE coordinator_id = ?").run(coordinatorId);
    },

    /**
     * Records a `reminder` event for a reminder still due at `now`, and removes a one-off or moves
     * a repeating one to its next time after now, together. One cancelled or already recorded
     * since it was read records nothing.
     */
    fireReminder(id: ReminderId, now: number): void {
      db().transaction(() => {
        const row = db().prepare("SELECT id, coordinator_id AS coordinatorId, note, due_at AS dueAt, every_ms AS everyMs FROM reminders WHERE id = ? AND due_at <= ?").get(rowIdOf(id), now);
        if (row === undefined) return;
        const { coordinatorId, ...reminder } = reminderRowSchema.extend({ coordinatorId: coordinatorIdSchema }).parse(row);
        insertEvent(coordinatorId, { kind: "reminder", reminderId: reminder.id, note: reminder.note, dueAt: reminder.dueAt, everyMs: reminder.everyMs }, now);
        const next = nextDue(reminder, now);
        if (next === null) db().prepare("DELETE FROM reminders WHERE id = ?").run(rowIdOf(id));
        else db().prepare("UPDATE reminders SET due_at = ? WHERE id = ?").run(next, rowIdOf(id));
      })();
    },

    /** Puts a decision to the user for the coordinating thread, and returns it with its id. */
    insertDecision(coordinatorId: CoordinatorId, { question, options }: Pick<Decision, "question" | "options">, at: number): Decision {
      const row = db()
        .prepare(`INSERT INTO decisions (coordinator_id, question, options, asked_at) VALUES (?, ?, ?, ?) RETURNING ${DECISION_COLUMNS}`)
        .get(coordinatorId, question, JSON.stringify(options), at);
      return toDecision(row);
    },

    /** A decision by its id, answered or not; null when there is none. */
    decision(id: DecisionId): Decision | null {
      const row = db().prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE id = ?`).get(rowIdOfDecision(id));
      return row === undefined ? null : toDecision(row);
    },

    /** Every decision the coordinating thread put to the user, in the order it asked them. */
    decisions(coordinatorId: CoordinatorId): Decision[] {
      return db().prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE coordinator_id = ? ORDER BY id`).all(coordinatorId).map(toDecision);
    },

    /**
     * Stores the user's answer to one of the coordinating thread's decisions, and records it for the
     * thread, together; or says why it didn't: it has no decision by that id, or that one was answered.
     */
    answerDecision(coordinatorId: CoordinatorId, id: DecisionId, answer: string, at: number): "answered" | "already-answered" | "unknown" {
      return db().transaction(() => {
        const updated = db().prepare("UPDATE decisions SET answer = ?, answered_at = ? WHERE id = ? AND coordinator_id = ? AND answer IS NULL").run(answer, at, rowIdOfDecision(id), coordinatorId);
        if (updated.changes > 0) {
          insertEvent(coordinatorId, { kind: "decision-answered", decisionId: id }, at);
          return "answered";
        }
        const exists = db().prepare("SELECT 1 FROM decisions WHERE id = ? AND coordinator_id = ?").get(rowIdOfDecision(id), coordinatorId) !== undefined;
        return exists ? "already-answered" : "unknown";
      })();
    },

    /** Every coordinator whose thread is bound, newest first. */
    coordinators(): Coordinator[] {
      return db()
        .prepare(
          `SELECT c.id, r.thread_id AS threadId, c.project_id AS projectId, c.verify, c.created_at AS createdAt
             FROM coordinators c JOIN roles r ON r.ticket = c.ticket
            WHERE r.thread_id IS NOT NULL
            ORDER BY c.created_at DESC, c.rowid DESC`,
        )
        .all()
        .map(toCoordinator);
    },
  };
}

// why: SQLite has no boolean; verify is stored as 0 or 1.
const coordinatorRowSchema = coordinatorSchema.extend({ verify: z.number().transform((verify) => verify === 1) });
const toCoordinator = (row: unknown): Coordinator => coordinatorRowSchema.parse(row);

const isAt = (verdict: Verdict, from: VerdictFrom): boolean =>
  from.state === "queued" ? verdict.state === "queued" : verdict.state === "running" && verdict.verifierThreadId === from.verifierThreadId;

const openVerdictRowSchema = z.object({
  handoffId: handoffIdSchema,
  coordinatorId: coordinatorIdSchema,
  crewId: crewIdSchema,
  verdict: z.string().transform((json) => verdictSchema.parse(JSON.parse(json))),
});

function toOpenVerdict(row: unknown): OpenVerdict {
  const { verdict, ...owner } = openVerdictRowSchema.parse(row);
  // why throw: every query here picks only queued and running verdicts.
  if (verdict.state !== "queued" && verdict.state !== "running") throw new Error(`The verdict of ${owner.handoffId} is ${verdict.state}, not waiting`);
  return { ...owner, verdict };
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
  fixRounds: z.number().int(),
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

const polledSchema = z.object({
  unavailable: z
    .string()
    .nullable()
    .transform((json) => (json === null ? null : prUnavailableSchema.parse(JSON.parse(json)))),
  polledAt: z.number(),
});
const prStatusRowSchema = z.union([
  polledSchema.extend({ snapshot: z.null() }),
  polledSchema.extend({
    snapshot: z.string().transform((json) => prSnapshotSchema.parse(JSON.parse(json))),
    headSeenAt: z.number(),
    readAt: z.number(),
    handoffAtRead: handoffIdSchema.nullable(),
  }),
]);

/** A reminder's row id is its number: `r7` is row 7. */
const reminderRowIdSchema = z.number().int().transform((id) => reminderIdSchema.parse(`r${id}`));
const rowIdOf = (id: ReminderId): number => Number(id.slice(1));
const reminderRowSchema = z.object({ id: reminderRowIdSchema, note: z.string(), dueAt: z.number(), everyMs: z.number().nullable() });
const toReminder = (row: unknown): Reminder => reminderRowSchema.parse(row);

/** A decision's row id is its number: `d7` is row 7. */
const rowIdOfDecision = (id: DecisionId): number => Number(id.slice(1));
const DECISION_COLUMNS = "id, question, options, asked_at AS askedAt, answer, answered_at AS answeredAt";
const decisionRowSchema = z.object({
  id: z.number().int().transform((id) => decisionIdSchema.parse(`d${id}`)),
  question: z.string(),
  options: z.string().transform((json) => z.array(z.string()).parse(JSON.parse(json))),
  askedAt: z.number(),
});
// why a union: the answer and its time are written together, or not at all.
const answerColumnsSchema = z.union([
  z.object({ answer: z.null(), answeredAt: z.null() }).transform(() => null),
  z.object({ answer: z.string(), answeredAt: z.number() }).transform(({ answer, answeredAt }) => ({ text: answer, at: answeredAt })),
]);
const toDecision = (row: unknown): Decision => ({ ...decisionRowSchema.parse(row), answer: answerColumnsSchema.parse(row) });

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

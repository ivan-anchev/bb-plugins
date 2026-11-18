// What the plugin tells a regional manager, and what it waits on the user for: events and the
// doorbells that announce them, the reminders it set itself, and the decisions it put to the user.
import { z } from "zod";
import { decisionIdSchema, type DecisionId, type Decision } from "../../../model/decision.ts";
import { inboxEventSchema, type InboxEvent, type StoredEvent } from "../../../model/inbox/inbox-event.ts";
import { CLEAN_TREE, sameFiles, type OwnTree } from "../../../model/inbox/own-tree.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import { unblockedSince } from "../../../model/issue/relations.ts";
import type { IssueView } from "../../../model/issue/status.ts";
import { nextDue, reminderIdSchema, type Reminder, type ReminderId } from "../../../model/reminder.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../../model/role.ts";
import { knownCloses, rememberCloses } from "../issue/issues-store.ts";
import { json, type Db } from "../rows.ts";

/** Records something to tell the regional manager, neither announced nor read yet. Call inside the transaction that records what it tells. */
export function insertEvent(db: Db, coordinatorId: CoordinatorId, event: InboxEvent, at: number): void {
  db().prepare("INSERT INTO events (coordinator_id, event, at) VALUES (?, ?, ?)").run(coordinatorId, JSON.stringify(event), at);
}

/**
 * Marks the regional manager's queued doorbell stale, to be taken back (see the migrations), and
 * makes every unread event unannounced again, so the doorbell rung once it is gone names them. Call
 * inside the transaction of the write that left the doorbell saying what is no longer unread.
 */
function markDoorbellStale(db: Db, coordinatorId: CoordinatorId): void {
  // why only with a doorbell queued: an unread event a sent doorbell announced is told; ringing it again would wake the thread twice.
  if (db().prepare("UPDATE doorbells SET stale = 1 WHERE coordinator_id = ?").run(coordinatorId).changes === 0) return;
  db().prepare("UPDATE events SET announced_at = NULL WHERE coordinator_id = ? AND read_at IS NULL").run(coordinatorId);
}

export function inboxStore(db: Db) {
  /** The regional manager's own checkout as last read; clean when it was never read. */
  function ownTree(coordinatorId: CoordinatorId): OwnTree {
    const row = db().prepare("SELECT files, file_count AS fileCount, default_branch AS defaultBranch FROM own_trees WHERE coordinator_id = ?").get(coordinatorId);
    return row === undefined ? CLEAN_TREE : ownTreeRowSchema.parse(row);
  }

  return {
    insertEvent: (coordinatorId: CoordinatorId, event: InboxEvent, at: number): void => insertEvent(db, coordinatorId, event, at),

    ownTree,

    /**
     * Saves a turn-end read of the regional manager's own checkout, and keeps one current correction:
     * when it found other files than the read before it, it retires the unread
     * `coordinator-tree-changed` event, which told of an older read, and records a new one if the
     * checkout has changed files, deciding from the read before it in the same transaction. A queued
     * doorbell that announced the retired event is marked stale. Returns whether it recorded one.
     */
    recordOwnTree(coordinatorId: CoordinatorId, read: OwnTree, at: number): boolean {
      return db().transaction(() => {
        const changed = !sameFiles(ownTree(coordinatorId), read);
        db()
          .prepare("INSERT INTO own_trees (coordinator_id, files, file_count, default_branch) VALUES (?, ?, ?, ?) ON CONFLICT (coordinator_id) DO UPDATE SET files = excluded.files, file_count = excluded.file_count, default_branch = excluded.default_branch")
          .run(coordinatorId, JSON.stringify(read.files), read.fileCount, read.defaultBranch);
        if (!changed) return false;
        const retired = db()
          .prepare("DELETE FROM events WHERE coordinator_id = ? AND read_at IS NULL AND json_extract(event, '$.kind') = 'coordinator-tree-changed' RETURNING announced_at AS announcedAt")
          .all(coordinatorId)
          .map((row) => z.object({ announcedAt: z.number().nullable() }).parse(row));
        if (retired.some(({ announcedAt }) => announcedAt !== null)) markDoorbellStale(db, coordinatorId);
        if (read.fileCount === 0) return false;
        insertEvent(db, coordinatorId, { kind: "coordinator-tree-changed" }, at);
        return true;
      })();
    },

    /**
     * Records an `unblocked` event for each issue that every issue as viewed now (`views`, read whole)
     * says was unblocked since the closes the regional manager knows of its relations, and remembers
     * the closes it learned on those relations, deciding from what it knew in the same transaction
     * (see unblockedSince). Returns whether it recorded one.
     */
    recordUnblocked(coordinatorId: CoordinatorId, views: readonly IssueView[], at: number): boolean {
      return db().transaction(() => {
        const { unblocked, learned } = unblockedSince(knownCloses(db, coordinatorId), views);
        rememberCloses(db, coordinatorId, learned);
        for (const unblocking of unblocked) insertEvent(db, coordinatorId, { kind: "unblocked", ...unblocking }, at);
        return unblocked.length > 0;
      })();
    },

    /** Whether an issue of the regional manager depends on another: whether there is anything to read for what was unblocked. */
    hasDependencies(coordinatorId: CoordinatorId): boolean {
      const row = db().prepare("SELECT EXISTS (SELECT 1 FROM issue_relations WHERE coordinator_id = ?) AS any").get(coordinatorId);
      return z.object({ any: z.number() }).parse(row).any === 1;
    },

    /** The events no doorbell has announced and no catch-up has returned, in the order recorded. */
    unannounced(coordinatorId: CoordinatorId): StoredEvent[] {
      return db().prepare("SELECT id, at, event FROM events WHERE coordinator_id = ? AND announced_at IS NULL AND read_at IS NULL ORDER BY id").all(coordinatorId).map(toEvent);
    },

    /** Every regional manager with an event to announce. */
    coordinatorsToRing(): CoordinatorId[] {
      return db()
        .prepare("SELECT DISTINCT coordinator_id AS id FROM events WHERE announced_at IS NULL AND read_at IS NULL")
        .all()
        .map((row) => z.object({ id: coordinatorIdSchema }).parse(row).id);
    },

    /** Marks the events announced by a doorbell, and keeps the doorbell when bb queued it rather than sending it (null: sent), together. */
    announce(coordinatorId: CoordinatorId, eventIds: readonly number[], queuedMessageId: string | null, at: number): void {
      db().transaction(() => {
        const mark = db().prepare("UPDATE events SET announced_at = ? WHERE id = ?");
        for (const eventId of eventIds) mark.run(at, eventId);
        if (queuedMessageId !== null) db().prepare("INSERT INTO doorbells (coordinator_id, queued_message_id) VALUES (?, ?)").run(coordinatorId, queuedMessageId);
      })();
    },

    /** Every unread event, marked read as it is returned, in the order recorded, and the queued doorbell, which announces none of them now, marked stale, together. */
    takeUnread(coordinatorId: CoordinatorId, at: number): StoredEvent[] {
      return db().transaction(() => {
        const events = db().prepare("UPDATE events SET read_at = ? WHERE coordinator_id = ? AND read_at IS NULL RETURNING id, at, event").all(at, coordinatorId).map(toEvent);
        markDoorbellStale(db, coordinatorId);
        return events.sort((a, b) => a.id - b.id);
      })();
    },

    /** The queued doorbell of a regional manager, or null when none is waiting. */
    doorbell(coordinatorId: CoordinatorId): string | null {
      const row = db().prepare("SELECT queued_message_id AS id FROM doorbells WHERE coordinator_id = ?").get(coordinatorId);
      return row === undefined ? null : z.object({ id: z.string() }).parse(row).id;
    },

    /** The queued doorbell of a regional manager when it is stale, to be taken back (see markDoorbellStale), or null. */
    staleDoorbell(coordinatorId: CoordinatorId): string | null {
      const row = db().prepare("SELECT queued_message_id AS id FROM doorbells WHERE coordinator_id = ? AND stale = 1").get(coordinatorId);
      return row === undefined ? null : z.object({ id: z.string() }).parse(row).id;
    },

    /** Every queued doorbell, with the thread it waits in, and whether it is stale. */
    doorbells(): { coordinatorId: CoordinatorId; threadId: string; queuedMessageId: string; stale: boolean }[] {
      return db()
        .prepare(
          `SELECT d.coordinator_id AS coordinatorId, r.thread_id AS threadId, d.queued_message_id AS queuedMessageId, d.stale
             FROM doorbells d JOIN coordinators c ON c.id = d.coordinator_id JOIN roles r ON r.ticket = c.ticket`,
        )
        .all()
        .map((row) => z.object({ coordinatorId: coordinatorIdSchema, threadId: z.string(), queuedMessageId: z.string(), stale: z.number().transform((flag) => flag === 1) }).parse(row));
    },

    /** Forgets the queued doorbell with this message id, and returns whose it was (null: no doorbell has it). */
    clearDoorbell(queuedMessageId: string): CoordinatorId | null {
      const row = db().prepare("DELETE FROM doorbells WHERE queued_message_id = ? RETURNING coordinator_id AS id").get(queuedMessageId);
      return row === undefined ? null : z.object({ id: coordinatorIdSchema }).parse(row).id;
    },

    /** Forgets a doorbell that never reached its thread, and makes every unread event of its regional manager unannounced again, together, so the next doorbell names them. */
    reopenDoorbell(queuedMessageId: string): void {
      db().transaction(() => {
        const row = db().prepare("DELETE FROM doorbells WHERE queued_message_id = ? RETURNING coordinator_id AS id").get(queuedMessageId);
        if (row === undefined) return;
        const { id } = z.object({ id: coordinatorIdSchema }).parse(row);
        db().prepare("UPDATE events SET announced_at = NULL WHERE coordinator_id = ? AND read_at IS NULL").run(id);
      })();
    },

    /** Sets a reminder for the regional manager, and returns it with its id. */
    insertReminder(coordinatorId: CoordinatorId, { note, dueAt, everyMs }: Omit<Reminder, "id">): Reminder {
      const row = db().prepare(`INSERT INTO reminders (coordinator_id, note, due_at, every_ms) VALUES (?, ?, ?, ?) RETURNING ${REMINDER_COLUMNS}`).get(coordinatorId, note, dueAt, everyMs);
      return toReminder(row);
    },

    /** The regional manager's reminders, soonest due first. */
    reminders(coordinatorId: CoordinatorId): Reminder[] {
      return db().prepare(`SELECT ${REMINDER_COLUMNS} FROM reminders WHERE coordinator_id = ? ORDER BY due_at, id`).all(coordinatorId).map(toReminder);
    },

    /** Cancels one of the regional manager's reminders, and returns it (null: it has none by that id). */
    cancelReminder(coordinatorId: CoordinatorId, id: ReminderId): Reminder | null {
      const row = db().prepare(`DELETE FROM reminders WHERE id = ? AND coordinator_id = ? RETURNING ${REMINDER_COLUMNS}`).get(rowIdOf(id), coordinatorId);
      return row === undefined ? null : toReminder(row);
    },

    /** Every reminder due at `now`, with its regional manager and that manager's thread. */
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

    /**
     * Records a `reminder` event for a reminder still due at `now`, and removes a one-off or moves a
     * repeating one to its next time after now, together. One cancelled or already recorded since
     * it was read records nothing.
     */
    fireReminder(id: ReminderId, now: number): void {
      db().transaction(() => {
        const row = db().prepare(`SELECT ${REMINDER_COLUMNS}, coordinator_id AS coordinatorId FROM reminders WHERE id = ? AND due_at <= ?`).get(rowIdOf(id), now);
        if (row === undefined) return;
        const { coordinatorId, ...reminder } = reminderRowSchema.extend({ coordinatorId: coordinatorIdSchema }).parse(row);
        insertEvent(db, coordinatorId, { kind: "reminder", reminderId: reminder.id, note: reminder.note, dueAt: reminder.dueAt, everyMs: reminder.everyMs }, now);
        const next = nextDue(reminder, now);
        if (next === null) db().prepare("DELETE FROM reminders WHERE id = ?").run(rowIdOf(id));
        else db().prepare("UPDATE reminders SET due_at = ? WHERE id = ?").run(next, rowIdOf(id));
      })();
    },

    /** Puts a decision to the user for the regional manager, flagging `issueId` Needs you until answered (null: none), and returns it with its id. */
    insertDecision(coordinatorId: CoordinatorId, { question, options, issueId }: Pick<Decision, "question" | "options" | "issueId">, at: number): Decision {
      const row = db()
        .prepare(`INSERT INTO decisions (coordinator_id, issue_id, question, options, asked_at) VALUES (?, ?, ?, ?, ?) RETURNING ${DECISION_COLUMNS}`)
        .get(coordinatorId, issueId, question, JSON.stringify(options), at);
      return toDecision(row);
    },

    /** A decision by its id, answered or not; null when there is none. */
    decision(id: DecisionId): Decision | null {
      const row = db().prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE id = ?`).get(rowIdOfDecision(id));
      return row === undefined ? null : toDecision(row);
    },

    /** Every decision the regional manager put to the user, in the order it asked them. */
    decisions(coordinatorId: CoordinatorId): Decision[] {
      return db().prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE coordinator_id = ? ORDER BY id`).all(coordinatorId).map(toDecision);
    },

    /**
     * Stores the user's answer to one of the regional manager's decisions, and records it for the
     * manager, together; or says why it didn't: it has no decision by that id, or that one was answered.
     */
    answerDecision(coordinatorId: CoordinatorId, id: DecisionId, answer: string, at: number): "answered" | "already-answered" | "unknown" {
      return db().transaction(() => {
        const updated = db().prepare("UPDATE decisions SET answer = ?, answered_at = ? WHERE id = ? AND coordinator_id = ? AND answer IS NULL").run(answer, at, rowIdOfDecision(id), coordinatorId);
        if (updated.changes > 0) {
          insertEvent(db, coordinatorId, { kind: "decision-answered", decisionId: id }, at);
          return "answered";
        }
        const exists = db().prepare("SELECT 1 FROM decisions WHERE id = ? AND coordinator_id = ?").get(rowIdOfDecision(id), coordinatorId) !== undefined;
        return exists ? "already-answered" : "unknown";
      })();
    },
  };
}

const eventRowSchema = z.object({ id: z.number().int(), at: z.number(), event: json(inboxEventSchema) });
const toEvent = (row: unknown): StoredEvent => eventRowSchema.parse(row);

const ownTreeRowSchema = z.object({ files: json(z.array(z.string())), fileCount: z.number().int().min(0), defaultBranch: z.string().nullable() });

/** A reminder's row id is its number: `r7` is row 7. */
const reminderRowIdSchema = z.number().int().transform((id) => reminderIdSchema.parse(`r${id}`));
const rowIdOf = (id: ReminderId): number => Number(id.slice(1));
const REMINDER_COLUMNS = "id, note, due_at AS dueAt, every_ms AS everyMs";
const reminderRowSchema = z.object({ id: reminderRowIdSchema, note: z.string(), dueAt: z.number(), everyMs: z.number().nullable() });
const toReminder = (row: unknown): Reminder => reminderRowSchema.parse(row);

/** A decision's row id is its number: `d7` is row 7. */
const rowIdOfDecision = (id: DecisionId): number => Number(id.slice(1));
const DECISION_COLUMNS = "id, issue_id AS issueId, question, options, asked_at AS askedAt, answer, answered_at AS answeredAt";
const decisionRowSchema = z.object({
  id: z.number().int().transform((id) => decisionIdSchema.parse(`d${id}`)),
  issueId: issueIdSchema.nullable(),
  question: z.string(),
  options: json(z.array(z.string())),
  askedAt: z.number(),
});
// why a union: the answer and its time are written together, or not at all.
const answerColumnsSchema = z.union([
  z.object({ answer: z.null(), answeredAt: z.null() }).transform(() => null),
  z.object({ answer: z.string(), answeredAt: z.number() }).transform(({ answer, answeredAt }) => ({ text: answer, at: answeredAt })),
]);
const toDecision = (row: unknown): Decision => ({ ...decisionRowSchema.parse(row), answer: answerColumnsSchema.parse(row) });

import { z } from "zod";
import { decisionIdSchema, type DecisionId, type Decision } from "../../../model/decision.ts";
import { inboxEventSchema, type InboxEvent, type StoredEvent } from "../../../model/inbox/inbox-event.ts";
import { ownTreeEventAfter, type OwnTreeEvent } from "../../../model/inbox/own-tree.ts";
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

export function inboxStore(db: Db) {
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
    if (event.kind !== "coordinator-edited-files" && event.kind !== "coordinator-tree-clean") throw new Error(`The event ${event.kind} is not about the working tree`);
    return { at, event };
  }

  return {
    insertEvent: (coordinatorId: CoordinatorId, event: InboxEvent, at: number): void => insertEvent(db, coordinatorId, event, at),

    lastOwnTreeEvent,

    recordOwnTree(coordinatorId: CoordinatorId, fileCount: number, at: number): boolean {
      return db().transaction(() => {
        const event = ownTreeEventAfter(lastOwnTreeEvent(coordinatorId)?.event ?? null, fileCount);
        if (event !== null) insertEvent(db, coordinatorId, event, at);
        return event !== null;
      })();
    },

    recordUnblocked(coordinatorId: CoordinatorId, views: readonly IssueView[], at: number): boolean {
      return db().transaction(() => {
        const { unblocked, learned } = unblockedSince(knownCloses(db, coordinatorId), views);
        rememberCloses(db, coordinatorId, learned);
        for (const unblocking of unblocked) insertEvent(db, coordinatorId, { kind: "unblocked", ...unblocking }, at);
        return unblocked.length > 0;
      })();
    },

    hasDependencies(coordinatorId: CoordinatorId): boolean {
      const row = db().prepare("SELECT EXISTS (SELECT 1 FROM issue_relations WHERE coordinator_id = ?) AS any").get(coordinatorId);
      return z.object({ any: z.number() }).parse(row).any === 1;
    },

    unannounced(coordinatorId: CoordinatorId): StoredEvent[] {
      return db().prepare("SELECT id, at, event FROM events WHERE coordinator_id = ? AND announced_at IS NULL AND read_at IS NULL ORDER BY id").all(coordinatorId).map(toEvent);
    },

    coordinatorsToRing(): CoordinatorId[] {
      return db()
        .prepare("SELECT DISTINCT coordinator_id AS id FROM events WHERE announced_at IS NULL AND read_at IS NULL")
        .all()
        .map((row) => z.object({ id: coordinatorIdSchema }).parse(row).id);
    },

    announce(coordinatorId: CoordinatorId, eventIds: readonly number[], queuedMessageId: string | null, at: number): void {
      db().transaction(() => {
        const mark = db().prepare("UPDATE events SET announced_at = ? WHERE id = ?");
        for (const eventId of eventIds) mark.run(at, eventId);
        if (queuedMessageId !== null) db().prepare("INSERT INTO doorbells (coordinator_id, queued_message_id) VALUES (?, ?)").run(coordinatorId, queuedMessageId);
      })();
    },

    takeUnread(coordinatorId: CoordinatorId, at: number): StoredEvent[] {
      return db()
        .prepare("UPDATE events SET read_at = ? WHERE coordinator_id = ? AND read_at IS NULL RETURNING id, at, event")
        .all(at, coordinatorId)
        .map(toEvent)
        .sort((a, b) => a.id - b.id);
    },

    doorbell(coordinatorId: CoordinatorId): string | null {
      const row = db().prepare("SELECT queued_message_id AS id FROM doorbells WHERE coordinator_id = ?").get(coordinatorId);
      return row === undefined ? null : z.object({ id: z.string() }).parse(row).id;
    },

    doorbells(): { coordinatorId: CoordinatorId; threadId: string; queuedMessageId: string }[] {
      return db()
        .prepare(
          `SELECT d.coordinator_id AS coordinatorId, r.thread_id AS threadId, d.queued_message_id AS queuedMessageId
             FROM doorbells d JOIN coordinators c ON c.id = d.coordinator_id JOIN roles r ON r.ticket = c.ticket`,
        )
        .all()
        .map((row) => z.object({ coordinatorId: coordinatorIdSchema, threadId: z.string(), queuedMessageId: z.string() }).parse(row));
    },

    clearDoorbell(queuedMessageId: string): CoordinatorId | null {
      const row = db().prepare("DELETE FROM doorbells WHERE queued_message_id = ? RETURNING coordinator_id AS id").get(queuedMessageId);
      return row === undefined ? null : z.object({ id: coordinatorIdSchema }).parse(row).id;
    },

    reopenDoorbell(queuedMessageId: string): void {
      db().transaction(() => {
        const row = db().prepare("DELETE FROM doorbells WHERE queued_message_id = ? RETURNING coordinator_id AS id").get(queuedMessageId);
        if (row === undefined) return;
        const { id } = z.object({ id: coordinatorIdSchema }).parse(row);
        db().prepare("UPDATE events SET announced_at = NULL WHERE coordinator_id = ? AND read_at IS NULL").run(id);
      })();
    },

    insertReminder(coordinatorId: CoordinatorId, { note, dueAt, everyMs }: Omit<Reminder, "id">): Reminder {
      const row = db().prepare(`INSERT INTO reminders (coordinator_id, note, due_at, every_ms) VALUES (?, ?, ?, ?) RETURNING ${REMINDER_COLUMNS}`).get(coordinatorId, note, dueAt, everyMs);
      return toReminder(row);
    },

    reminders(coordinatorId: CoordinatorId): Reminder[] {
      return db().prepare(`SELECT ${REMINDER_COLUMNS} FROM reminders WHERE coordinator_id = ? ORDER BY due_at, id`).all(coordinatorId).map(toReminder);
    },

    cancelReminder(coordinatorId: CoordinatorId, id: ReminderId): Reminder | null {
      const row = db().prepare(`DELETE FROM reminders WHERE id = ? AND coordinator_id = ? RETURNING ${REMINDER_COLUMNS}`).get(rowIdOf(id), coordinatorId);
      return row === undefined ? null : toReminder(row);
    },

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

    insertDecision(coordinatorId: CoordinatorId, { question, options, issueId }: Pick<Decision, "question" | "options" | "issueId">, at: number): Decision {
      const row = db()
        .prepare(`INSERT INTO decisions (coordinator_id, issue_id, question, options, asked_at) VALUES (?, ?, ?, ?, ?) RETURNING ${DECISION_COLUMNS}`)
        .get(coordinatorId, issueId, question, JSON.stringify(options), at);
      return toDecision(row);
    },

    decision(id: DecisionId): Decision | null {
      const row = db().prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE id = ?`).get(rowIdOfDecision(id));
      return row === undefined ? null : toDecision(row);
    },

    decisions(coordinatorId: CoordinatorId): Decision[] {
      return db().prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE coordinator_id = ? ORDER BY id`).all(coordinatorId).map(toDecision);
    },

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

const reminderRowIdSchema = z.number().int().transform((id) => reminderIdSchema.parse(`r${id}`));
const rowIdOf = (id: ReminderId): number => Number(id.slice(1));
const REMINDER_COLUMNS = "id, note, due_at AS dueAt, every_ms AS everyMs";
const reminderRowSchema = z.object({ id: reminderRowIdSchema, note: z.string(), dueAt: z.number(), everyMs: z.number().nullable() });
const toReminder = (row: unknown): Reminder => reminderRowSchema.parse(row);

const rowIdOfDecision = (id: DecisionId): number => Number(id.slice(1));
const DECISION_COLUMNS = "id, issue_id AS issueId, question, options, asked_at AS askedAt, answer, answered_at AS answeredAt";
const decisionRowSchema = z.object({
  id: z.number().int().transform((id) => decisionIdSchema.parse(`d${id}`)),
  issueId: issueIdSchema.nullable(),
  question: z.string(),
  options: json(z.array(z.string())),
  askedAt: z.number(),
});
const answerColumnsSchema = z.union([
  z.object({ answer: z.null(), answeredAt: z.null() }).transform(() => null),
  z.object({ answer: z.string(), answeredAt: z.number() }).transform(({ answer, answeredAt }) => ({ text: answer, at: answeredAt })),
]);
const toDecision = (row: unknown): Decision => ({ ...decisionRowSchema.parse(row), answer: answerColumnsSchema.parse(row) });

import type Database from "better-sqlite3";
import { z } from "zod";
import { failureReasonSchema, type FailureReason } from "./delivery.ts";
import { targetSchema, type Target } from "./routes.ts";
import { wakeBodySchema, type WakeBody } from "./wake-body.ts";

/** One undelivered event. Holds no URL, key, or headers: only what was sent and why it failed. */
export interface FailureEntry {
  id: number;
  at: number;
  target: Target;
  body: WakeBody;
  reason: FailureReason;
}

export interface FailureLog {
  record(target: Target, body: WakeBody, reason: FailureReason): void;
  /** Oldest first. */
  list(): FailureEntry[];
  remove(id: number): void;
  updateReason(id: number, reason: FailureReason): void;
}

type Migrate = (db: Database.Database, statements: string[]) => void;

/** Append-only: never edit or reorder a shipped statement. */
const MIGRATIONS = [
  `CREATE TABLE failures (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     target TEXT NOT NULL,
     body TEXT NOT NULL,
     reason TEXT NOT NULL
   )`,
];

const rowSchema = z.object({
  id: z.number(),
  at: z.number(),
  target: targetSchema,
  body: z.string().transform((text) => wakeBodySchema.parse(JSON.parse(text))),
  reason: failureReasonSchema,
});

/** The failure log in the plugin's own SQLite file (`<dataDir>/plugins/bot-wake/data.db`). */
export function openFailureLog(db: Database.Database, migrate: Migrate): FailureLog {
  migrate(db, MIGRATIONS);
  const insert = db.prepare("INSERT INTO failures (at, target, body, reason) VALUES (?, ?, ?, ?)");
  const selectAll = db.prepare("SELECT id, at, target, body, reason FROM failures ORDER BY id");
  const deleteOne = db.prepare("DELETE FROM failures WHERE id = ?");
  const setReason = db.prepare("UPDATE failures SET reason = ? WHERE id = ?");

  return {
    record(target, body, reason) {
      insert.run(Date.now(), target, JSON.stringify(body), reason);
    },
    list() {
      return selectAll.all().map((row) => rowSchema.parse(row));
    },
    remove(id) {
      deleteOne.run(id);
    },
    updateReason(id, reason) {
      setReason.run(reason, id);
    },
  };
}

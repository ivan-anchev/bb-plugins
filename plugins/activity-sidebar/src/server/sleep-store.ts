// The plugin's SQLite: one row per thread put to sleep (or woken and not opened since). Every SQL
// statement lives here.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { sleepRecordSchema, type SleepRecord } from "../contract.ts";

// Append-only: bb.storage.migrate records each statement's hash by its index.
const MIGRATIONS = [`CREATE TABLE sleeps (thread_id TEXT PRIMARY KEY, until INTEGER NOT NULL)`];

const rowsSchema = z.array(sleepRecordSchema);

export type SleepStore = ReturnType<typeof openSleepStore>;

export function openSleepStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
    all(): SleepRecord[] {
      return rowsSchema.parse(db().prepare("SELECT thread_id AS threadId, until FROM sleeps").all());
    },

    // One row per thread, so two clients writing two threads never touch a shared value. Same input, same row.
    set(threadId: string, until: number | null): void {
      if (until === null) db().prepare("DELETE FROM sleeps WHERE thread_id = ?").run(threadId);
      else db().prepare("INSERT OR REPLACE INTO sleeps (thread_id, until) VALUES (?, ?)").run(threadId, until);
    },
  };
}

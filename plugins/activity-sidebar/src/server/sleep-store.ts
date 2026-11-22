import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { sleepRecordSchema, type SleepRecord } from "../contract.ts";

const MIGRATIONS = [`CREATE TABLE sleeps (thread_id TEXT PRIMARY KEY, until INTEGER NOT NULL)`];

const rowsSchema = z.array(sleepRecordSchema);

export type SleepStore = ReturnType<typeof openSleepStore>;

export function openSleepStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
    all(): SleepRecord[] {
      return rowsSchema.parse(db().prepare("SELECT thread_id AS threadId, until FROM sleeps").all());
    },

    set(threadId: string, until: number | null): void {
      if (until === null) db().prepare("DELETE FROM sleeps WHERE thread_id = ?").run(threadId);
      else db().prepare("INSERT OR REPLACE INTO sleeps (thread_id, until) VALUES (?, ?)").run(threadId, until);
    },
  };
}

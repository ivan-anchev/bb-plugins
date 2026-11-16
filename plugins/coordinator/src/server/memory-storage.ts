// Tests only: bb.storage over a fresh in-memory SQLite, the way openStore reads it, and the database
// itself for what the store never reads back.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";

export function memoryStorage() {
  const db = new Database(":memory:");
  // why count: as bb does, a migration runs once, so a store opened again on this storage, as after a reload, runs only the new ones.
  let applied = 0;
  const storage: Pick<PluginStorage, "database" | "migrate"> = {
    database: () => db,
    migrate(handle, statements) {
      statements.slice(applied).forEach((statement) => handle.exec(statement));
      applied = statements.length;
    },
  };
  return { db, storage };
}

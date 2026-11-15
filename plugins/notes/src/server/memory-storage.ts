// Tests only: bb.storage over a fresh in-memory SQLite, the way openStore reads it, and the database
// itself for what the store never reads back (such as when a note was archived).
import type { PluginStorage } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";

export function memoryStorage() {
  const db = new Database(":memory:");
  const storage: Pick<PluginStorage, "database" | "migrate"> = {
    database: () => db,
    migrate: (handle, statements) => statements.forEach((statement) => handle.exec(statement)),
  };
  return { db, storage };
}

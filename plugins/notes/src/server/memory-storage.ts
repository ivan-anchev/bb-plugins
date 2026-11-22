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

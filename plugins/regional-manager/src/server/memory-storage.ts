import type { PluginStorage } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";

export function memoryStorage() {
  const db = new Database(":memory:");
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

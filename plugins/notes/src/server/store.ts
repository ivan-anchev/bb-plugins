// The plugin's SQLite: one row per note. Every SQL statement lives here.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { noteSchema, type Note } from "../contract.ts";

// Append-only: bb.storage.migrate records each statement's hash by its index.
const MIGRATIONS = [
  // why JSON columns: quote and body are read and written whole, never queried inside.
  `CREATE TABLE notes (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, archived_at INTEGER,
     quote TEXT, body TEXT NOT NULL)`,
  `CREATE INDEX notes_active ON notes (archived_at, created_at)`,
];

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
    /** Every note not archived, newest first. */
    activeNotes(): Note[] {
      return db().prepare("SELECT * FROM notes WHERE archived_at IS NULL ORDER BY created_at DESC, rowid DESC").all().map(toNote);
    },

    insert(note: Note): void {
      db()
        .prepare("INSERT INTO notes (id, created_at, quote, body) VALUES (?, ?, ?, ?)")
        .run(note.id, note.createdAt, note.quote === null ? null : JSON.stringify(note.quote), JSON.stringify(note.body));
    },
  };
}

// Database rows are a boundary: parse them into the canonical type.
const noteRowSchema = z.object({ id: z.string(), created_at: z.number(), quote: z.string().nullable(), body: z.string() });

function toNote(row: unknown): Note {
  const { id, created_at, quote, body } = noteRowSchema.parse(row);
  return noteSchema.parse({ id, createdAt: created_at, quote: quote === null ? null : JSON.parse(quote), body: JSON.parse(body) });
}

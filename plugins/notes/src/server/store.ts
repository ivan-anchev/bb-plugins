// The plugin's SQLite: one row per note, one per attachment. Every SQL statement lives here.
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { attachmentIdSchema, attachmentSchema, noteSchema, type Attachment, type Note } from "../contract.ts";

// Append-only: bb.storage.migrate records each statement's hash by its index.
const MIGRATIONS = [
  // why JSON columns: quote and body are read and written whole, never queried inside.
  `CREATE TABLE notes (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, archived_at INTEGER,
     quote TEXT, body TEXT NOT NULL)`,
  `CREATE INDEX notes_active ON notes (archived_at, created_at)`,
  // The attachment's bytes are a file named by its id, beside data.db (media-files.ts).
  `CREATE TABLE attachments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, position INTEGER NOT NULL,
     name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL)`,
  `CREATE INDEX attachments_by_note ON attachments (note_id, position)`,
];

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  // The host closes the handle on reload and reopens it on the next call, so never keep it.
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
    /** Every note not archived, newest first, each with its attachments in the order they were attached. */
    activeNotes(): Note[] {
      return withAttachments(db().prepare("SELECT * FROM notes WHERE archived_at IS NULL ORDER BY created_at DESC, rowid DESC").all());
    },

    /** The notes among `ids` not archived, oldest first: a brief reads in the order they were written. */
    activeNotesByIds(ids: readonly Note["id"][]): Note[] {
      const rows = db()
        .prepare("SELECT * FROM notes WHERE archived_at IS NULL AND id IN (SELECT value FROM json_each(?)) ORDER BY created_at, rowid")
        .all(JSON.stringify(ids));
      return withAttachments(rows);
    },

    /** The attachment with this id, or null when no note holds it. */
    attachment(id: Attachment["id"]): Attachment | null {
      const row = db().prepare("SELECT * FROM attachments WHERE id = ?").get(id);
      return row === undefined ? null : toAttachment(row).attachment;
    },

    /** The note and its attachments, together or not at all. */
    insert(note: Note): void {
      const insertNote = db().prepare("INSERT INTO notes (id, created_at, quote, body) VALUES (?, ?, ?, ?)");
      const insertAttachment = db().prepare(
        "INSERT INTO attachments (id, note_id, position, name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
      );
      db().transaction(() => {
        insertNote.run(note.id, note.createdAt, note.quote === null ? null : JSON.stringify(note.quote), JSON.stringify(note.body));
        note.attachments.forEach((attachment, position) =>
          insertAttachment.run(attachment.id, note.id, position, attachment.name, attachment.mimeType, attachment.sizeBytes),
        );
      })();
    },

    /**
     * Deletes the notes' rows, together or not at all, and returns the ids of the attachments they
     * held, whose files can go. A note already gone leaves nothing to delete, and that is fine.
     */
    delete(ids: readonly Note["id"][]): Attachment["id"][] {
      const list = JSON.stringify(ids);
      return db().transaction(() => {
        const fileIds = db()
          .prepare("SELECT id FROM attachments WHERE note_id IN (SELECT value FROM json_each(?))")
          .all(list)
          .map((row) => attachmentIdRowSchema.parse(row).id);
        db().prepare("DELETE FROM attachments WHERE note_id IN (SELECT value FROM json_each(?))").run(list);
        db().prepare("DELETE FROM notes WHERE id IN (SELECT value FROM json_each(?))").run(list);
        return fileIds;
      })();
    },

    /** Takes the notes off the card, keeping their rows. why COALESCE: archiving twice keeps the first time. */
    archive(ids: readonly Note["id"][], at: number): void {
      db().prepare("UPDATE notes SET archived_at = COALESCE(archived_at, ?) WHERE id IN (SELECT value FROM json_each(?))").run(at, JSON.stringify(ids));
    },
  };

  /** Note rows as notes, each with its attachments in the order they were attached. */
  function withAttachments(rows: unknown[]): Note[] {
    const notes = rows.map((row) => noteRowSchema.parse(row));
    const attachments = byNote(
      db()
        .prepare("SELECT * FROM attachments WHERE note_id IN (SELECT value FROM json_each(?)) ORDER BY position")
        .all(JSON.stringify(notes.map(({ id }) => id))),
    );
    return notes.map((row) => toNote(row, attachments));
  }
}

// ------------------------------------------------------------------ layer 2
// Database rows are a boundary: parse them into the canonical types.

const noteRowSchema = z.object({ id: z.string(), created_at: z.number(), quote: z.string().nullable(), body: z.string() });
const attachmentRowSchema = z.object({ id: z.string(), note_id: z.string(), name: z.string(), mime_type: z.string(), size_bytes: z.number() });
const attachmentIdRowSchema = z.object({ id: attachmentIdSchema });

/** `attachments`: every listed note's attachments, by note id, each list in position order. */
function toNote({ id, created_at, quote, body }: z.infer<typeof noteRowSchema>, attachments: ReadonlyMap<string, Attachment[]>): Note {
  return noteSchema.parse({
    id,
    createdAt: created_at,
    quote: quote === null ? null : JSON.parse(quote),
    body: JSON.parse(body),
    attachments: attachments.get(id) ?? [],
  });
}

/** Attachment rows, in the order read, grouped by the note that holds them. */
function byNote(rows: unknown[]): Map<string, Attachment[]> {
  const grouped = new Map<string, Attachment[]>();
  for (const { noteId, attachment } of rows.map(toAttachment)) grouped.set(noteId, [...(grouped.get(noteId) ?? []), attachment]);
  return grouped;
}

function toAttachment(row: unknown): { noteId: string; attachment: Attachment } {
  const { id, note_id, name, mime_type, size_bytes } = attachmentRowSchema.parse(row);
  return { noteId: note_id, attachment: attachmentSchema.parse({ id, name, mimeType: mime_type, sizeBytes: size_bytes }) };
}

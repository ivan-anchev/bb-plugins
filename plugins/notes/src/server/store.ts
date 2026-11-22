import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { attachmentIdSchema, attachmentSchema, noteIdSchema, noteSchema, type Attachment, type InDraft, type Note } from "../contract.ts";

const MIGRATIONS = [
  `CREATE TABLE notes (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, archived_at INTEGER,
     quote TEXT, body TEXT NOT NULL)`,
  `CREATE INDEX notes_active ON notes (archived_at, created_at)`,
  `CREATE TABLE attachments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, position INTEGER NOT NULL,
     name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL)`,
  `CREATE INDEX attachments_by_note ON attachments (note_id, position)`,
  `CREATE TABLE in_draft (note_id TEXT PRIMARY KEY, composer_key TEXT NOT NULL, brief TEXT NOT NULL)`,
];

export type Store = ReturnType<typeof openStore>;

export function openStore(storage: Pick<PluginStorage, "database" | "migrate">) {
  const db = () => storage.database();
  storage.migrate(db(), MIGRATIONS);

  return {
    activeNotes(): Note[] {
      return withAttachments(db().prepare("SELECT * FROM notes WHERE archived_at IS NULL ORDER BY created_at DESC, rowid DESC").all());
    },

    activeNotesByIds(ids: readonly Note["id"][]): Note[] {
      const rows = db()
        .prepare("SELECT * FROM notes WHERE archived_at IS NULL AND id IN (SELECT value FROM json_each(?)) ORDER BY created_at, rowid")
        .all(JSON.stringify(ids));
      return withAttachments(rows);
    },

    attachment(id: Attachment["id"]): Attachment | null {
      const row = db().prepare("SELECT * FROM attachments WHERE id = ?").get(id);
      return row === undefined ? null : toAttachment(row).attachment;
    },

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

    delete(ids: readonly Note["id"][]): Attachment["id"][] {
      const list = JSON.stringify(ids);
      return db().transaction(() => {
        const fileIds = db()
          .prepare("SELECT id FROM attachments WHERE note_id IN (SELECT value FROM json_each(?))")
          .all(list)
          .map((row) => attachmentIdRowSchema.parse(row).id);
        db().prepare("DELETE FROM attachments WHERE note_id IN (SELECT value FROM json_each(?))").run(list);
        db().prepare("DELETE FROM in_draft WHERE note_id IN (SELECT value FROM json_each(?))").run(list);
        db().prepare("DELETE FROM notes WHERE id IN (SELECT value FROM json_each(?))").run(list);
        return fileIds;
      })();
    },

    inDrafts(): InDraft[] {
      const rows = db().prepare("SELECT note_id, composer_key, brief FROM in_draft ORDER BY rowid").all().map((row) => inDraftRowSchema.parse(row));
      const drafts = new Map<string, InDraft>();
      for (const { note_id, composer_key, brief } of rows) {
        const key = JSON.stringify([composer_key, brief]);
        const draft = drafts.get(key) ?? { composerKey: composer_key, brief, noteIds: [] };
        draft.noteIds.push(note_id);
        drafts.set(key, draft);
      }
      return [...drafts.values()];
    },

    putInDraft({ composerKey, brief, noteIds }: InDraft): void {
      db()
        .prepare(
          `INSERT OR REPLACE INTO in_draft (note_id, composer_key, brief)
           SELECT id, ?, ? FROM notes WHERE archived_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
        )
        .run(composerKey, brief, JSON.stringify(noteIds));
    },

    leaveDraft({ composerKey, brief }: Pick<InDraft, "composerKey" | "brief">): void {
      db().prepare("DELETE FROM in_draft WHERE composer_key = ? AND brief = ?").run(composerKey, brief);
    },
  };

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

const noteRowSchema = z.object({ id: z.string(), created_at: z.number(), quote: z.string().nullable(), body: z.string() });
const attachmentRowSchema = z.object({ id: z.string(), note_id: z.string(), name: z.string(), mime_type: z.string(), size_bytes: z.number() });
const attachmentIdRowSchema = z.object({ id: attachmentIdSchema });
const inDraftRowSchema = z.object({ note_id: noteIdSchema, composer_key: z.string(), brief: z.string() });

function toNote({ id, created_at, quote, body }: z.infer<typeof noteRowSchema>, attachments: ReadonlyMap<string, Attachment[]>): Note {
  return noteSchema.parse({
    id,
    createdAt: created_at,
    quote: quote === null ? null : JSON.parse(quote),
    body: JSON.parse(body),
    attachments: attachments.get(id) ?? [],
  });
}

function byNote(rows: unknown[]): Map<string, Attachment[]> {
  const grouped = new Map<string, Attachment[]>();
  for (const { noteId, attachment } of rows.map(toAttachment)) grouped.set(noteId, [...(grouped.get(noteId) ?? []), attachment]);
  return grouped;
}

function toAttachment(row: unknown): { noteId: string; attachment: Attachment } {
  const { id, note_id, name, mime_type, size_bytes } = attachmentRowSchema.parse(row);
  return { noteId: note_id, attachment: attachmentSchema.parse({ id, name, mimeType: mime_type, sizeBytes: size_bytes }) };
}

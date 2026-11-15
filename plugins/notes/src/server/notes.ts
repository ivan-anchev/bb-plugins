// What happens when a note is written, archived or deleted: its rows in SQLite and its files on disk change
// together, and every open card is told to read again. The order is chosen so a failure at any step
// leaves at most a file no row names, which the next load's sweep removes, and never a row whose
// file is missing.
import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES, attachmentIdSchema, noteIdSchema, type Attachment, type NewFile, type NewNote, type Note } from "../contract.ts";
import type { MediaFiles } from "./media/media-files.ts";
import type { Store } from "./store.ts";

type Deps = { store: Store; media: MediaFiles; now: () => number; onChange: () => void };

export function createNotes({ store, media, now, onChange }: Deps) {
  return {
    async create(input: NewNote): Promise<Note> {
      const attachments: Attachment[] = [];
      const note: Note = { id: noteIdSchema.parse(`note_${randomUUID()}`), createdAt: now(), quote: input.quote, body: input.body, attachments };
      try {
        // why one at a time: each file is decoded in memory, and one may be 100 MB.
        for (const file of input.files) attachments.push(await saveFile(media, file));
        store.insert(note);
      } catch (error) {
        await media.remove(attachments.map(({ id }) => id));
        throw error;
      }
      onChange();
      return note;
    },

    /** Deletes the notes and their files for good, with one change for every open card. */
    async remove(ids: readonly Note["id"][]): Promise<void> {
      const fileIds = store.delete(ids);
      onChange();
      await media.remove(fileIds);
    },

    /** Takes the notes off every card. Their rows and files stay. */
    archive(ids: readonly Note["id"][]): void {
      store.archive(ids, now());
      onChange();
    },

    /** Removes files older than `before` that no note holds: left by a save that failed or crashed. */
    sweep(before: number): Promise<string[]> {
      return media.sweep((name) => {
        const id = attachmentIdSchema.safeParse(name);
        return id.success && store.attachment(id.data) !== null;
      }, before);
    },
  };
}

// ------------------------------------------------------------------ layer 2

/** Decodes one attached file and writes it under a new id. */
async function saveFile(media: MediaFiles, file: NewFile): Promise<Attachment> {
  const bytes = Buffer.from(file.base64, "base64");
  // why after decoding: the form checks too, but the server is the boundary.
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${file.name} is over 100 MB`);
  if (bytes.byteLength === 0) throw new Error(`${file.name} is empty`);
  const id = attachmentIdSchema.parse(`att_${randomUUID()}`);
  await media.write(id, bytes);
  return { id, name: file.name, mimeType: file.mimeType, sizeBytes: bytes.byteLength };
}

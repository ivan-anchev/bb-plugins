import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES, attachmentIdSchema, noteIdSchema, type Attachment, type InDraft, type NewFile, type NewNote, type Note } from "../contract.ts";
import type { MediaFiles } from "./media/media-files.ts";
import type { Store } from "./store.ts";

type Deps = { store: Store; media: MediaFiles; now: () => number; onChange: () => void };

export function createNotes({ store, media, now, onChange }: Deps) {
  async function remove(ids: readonly Note["id"][]): Promise<void> {
    const fileIds = store.delete(ids);
    onChange();
    await media.remove(fileIds);
  }

  return {
    async create(input: NewNote): Promise<Note> {
      const attachments: Attachment[] = [];
      const note: Note = { id: noteIdSchema.parse(`note_${randomUUID()}`), createdAt: now(), quote: input.quote, body: input.body, attachments };
      try {
        for (const file of input.files) attachments.push(await saveFile(media, file));
        store.insert(note);
      } catch (error) {
        await media.remove(attachments.map(({ id }) => id));
        throw error;
      }
      onChange();
      return note;
    },

    remove,

    putInDraft(draft: InDraft): void {
      store.putInDraft(draft);
      onChange();
    },

    leaveDraft(draft: Pick<InDraft, "composerKey" | "brief">): void {
      store.leaveDraft(draft);
      onChange();
    },

    async sent(composerKey: InDraft["composerKey"], text: string): Promise<void> {
      const held = store.inDrafts().filter((draft) => draft.composerKey === composerKey && text.includes(draft.brief));
      if (held.length > 0) await remove(held.flatMap(({ noteIds }) => noteIds));
    },

    sweep(before: number): Promise<string[]> {
      return media.sweep((name) => {
        const id = attachmentIdSchema.safeParse(name);
        return id.success && store.attachment(id.data) !== null;
      }, before);
    },
  };
}

async function saveFile(media: MediaFiles, file: NewFile): Promise<Attachment> {
  const bytes = Buffer.from(file.base64, "base64");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${file.name} is over 100 MB`);
  if (bytes.byteLength === 0) throw new Error(`${file.name} is empty`);
  const id = attachmentIdSchema.parse(`att_${randomUUID()}`);
  await media.write(id, bytes);
  return { id, name: file.name, mimeType: file.mimeType, sizeBytes: bytes.byteLength };
}

// Shared by server.ts and app.tsx: the note, its parts, and the rpc methods. Every type is inferred
// from its zod schema, so the wire, the SQLite rows (parsed with these schemas in store.ts) and the
// React props share one shape per concept.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const NOTES_TAG = "notes";

// why branded: a note id and a thread id are both strings; nothing may take one for the other.
export const noteIdSchema = z.string().regex(/^note_[0-9a-f-]{36}$/).brand<"NoteId">();

/** Text highlighted in an assistant reply, and where it came from. Notes typed from scratch have none. */
const quoteSchema = z.object({
  text: z.string().min(1),
  threadId: z.string().min(1),
  // why a snapshot: a note names its thread even once the thread is archived, deleted, or renamed.
  threadTitle: z.string().min(1),
  /** The message's `experimental_messageSeq`: the `msg` of a message link. */
  messageSeq: z.number().int().nonnegative(),
});

/** The user's own words. */
const noteBodySchema = z.object({
  text: z.string(),
  // why always empty: @ thread links are not written yet; stored bodies carry the field already.
  mentions: z.tuple([]),
});

/** An active note. Archived notes never leave the server, so there is no `archivedAt` here. */
export const noteSchema = z.object({
  id: noteIdSchema,
  createdAt: z.number().int(),
  quote: quoteSchema.nullable(),
  body: noteBodySchema,
});
export type Note = z.infer<typeof noteSchema>;

const newNoteSchema = z
  .object({ quote: quoteSchema.nullable(), body: noteBodySchema })
  // why here, not only in the form: the server is the boundary, and an empty note is an illegal state.
  .refine((note) => note.quote !== null || note.body.text.trim() !== "", "A note needs some text");
export type NewNote = z.infer<typeof newNoteSchema>;

export const notesContract = defineRpcContract({
  /** Every active note, newest first. */
  notes: { input: z.object({}), output: z.array(noteSchema), tags: () => [NOTES_TAG] },
  /** Saves a note and returns it. */
  createNote: { input: newNoteSchema, output: noteSchema },
});

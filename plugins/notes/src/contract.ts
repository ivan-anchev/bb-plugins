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
export type Quote = z.infer<typeof quoteSchema>;

/** A thread linked from a note's text: `text.slice(from, to)` is "@" + its title, in UTF-16 offsets. */
const threadMentionSchema = z.object({
  threadId: z.string().min(1),
  from: z.number().int().nonnegative(),
  to: z.number().int().positive(),
});

/** The user's own words, and the threads they linked in them with @. */
const noteBodySchema = z
  .object({ text: z.string(), mentions: z.array(threadMentionSchema) })
  // why: a range that misses its "@Title" token would label the card and the brief with other words.
  .refine(
    ({ text, mentions }) => mentions.every(({ from, to }) => from < to && to <= text.length && text[from] === "@"),
    "A thread link must cover an @ token in the note's text",
  )
  // why: the card names the first link, and the view draws the text between links, so links come in
  // reading order and never share a character.
  .refine(
    ({ mentions }) => mentions.every(({ from }, index) => index === 0 || mentions[index - 1].to <= from),
    "Thread links must be in order and must not overlap",
  );
export type NoteBody = z.infer<typeof noteBodySchema>;

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
  /** Deletes a note for good. A note already gone counts as deleted, so a second call succeeds. */
  deleteNote: { input: z.object({ id: noteIdSchema }), output: z.object({}) },
});

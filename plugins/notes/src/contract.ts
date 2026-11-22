import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const NOTES_TAG = "notes";

export const noteIdSchema = z.string().regex(/^note_[0-9a-f-]{36}$/).brand<"NoteId">();

const quoteSchema = z.object({
  text: z.string().min(1),
  threadId: z.string().min(1),
  threadTitle: z.string().min(1),
  messageSeq: z.number().int().nonnegative(),
});
export type Quote = z.infer<typeof quoteSchema>;

const threadMentionSchema = z.object({
  threadId: z.string().min(1),
  from: z.number().int().nonnegative(),
  to: z.number().int().positive(),
});

const noteBodySchema = z
  .object({ text: z.string(), mentions: z.array(threadMentionSchema) })
  .refine(
    ({ text, mentions }) => mentions.every(({ from, to }) => from < to && to <= text.length && text[from] === "@"),
    "A thread link must cover an @ token in the note's text",
  )
  .refine(
    ({ mentions }) => mentions.every(({ from }, index) => index === 0 || mentions[index - 1].to <= from),
    "Thread links must be in order and must not overlap",
  );
export type NoteBody = z.infer<typeof noteBodySchema>;

export const attachmentIdSchema = z.string().regex(/^att_[0-9a-f-]{36}$/).brand<"AttachmentId">();

/** The images and videos a note may hold. No SVG (it can run script) and no HEIC (browsers can't draw it). */
export const mediaMimeSchema = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);
export type MediaMime = z.infer<typeof mediaMimeSchema>;

/** 100 MB a file: a screen recording fits. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** An image or video saved with a note; its bytes are served at `mediaUrl(id)`. */
export const attachmentSchema = z.object({
  id: attachmentIdSchema,
  name: z.string().min(1),
  mimeType: mediaMimeSchema,
  sizeBytes: z.number().int().positive(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export function attachmentKind(mimeType: MediaMime): "image" | "video" {
  return mimeType.startsWith("video/") ? "video" : "image";
}

/** An active note. Archived notes never leave the server, so there is no `archivedAt` here. */
export const noteSchema = z.object({
  id: noteIdSchema,
  createdAt: z.number().int(),
  quote: quoteSchema.nullable(),
  body: noteBodySchema,
  /** In the order they were attached. */
  attachments: z.array(attachmentSchema),
});
export type Note = z.infer<typeof noteSchema>;

const newFileSchema = z.object({ name: z.string().min(1), mimeType: mediaMimeSchema, base64: z.string() });
export type NewFile = z.infer<typeof newFileSchema>;

/** At most this many files on one note. */
export const MAX_FILES = 20;

const newNoteSchema = z
  .object({ quote: quoteSchema.nullable(), body: noteBodySchema, files: z.array(newFileSchema).max(MAX_FILES) })
  .refine((note) => note.quote !== null || note.body.text.trim() !== "" || note.files.length > 0, "A note needs some text or a file");
export type NewNote = z.infer<typeof newNoteSchema>;

const briefMentionSchema = z.object({
  kind: z.literal("thread"),
  threadId: z.string().min(1),
  from: z.number().int().nonnegative(),
  to: z.number().int().positive(),
  label: z.string().min(1),
});

const briefAttachmentSchema = z.object({
  type: z.enum(["localFile", "localImage"]),
  path: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sourceProjectId: z.string().optional(),
});

const briefSchema = z.object({ text: z.string(), mentions: z.array(briefMentionSchema), attachments: z.array(briefAttachmentSchema) });
export type Brief = z.infer<typeof briefSchema>;

const pickedIdsSchema = z.array(noteIdSchema).min(1);
const noteIdsSchema = pickedIdsSchema.max(100);

const composerKeySchema = z.string().min(1);

const inDraftSchema = z.object({ composerKey: composerKeySchema, brief: z.string().min(1), noteIds: noteIdsSchema });
export type InDraft = z.infer<typeof inDraftSchema>;

export const notesContract = defineRpcContract({
  /** Every active note, newest first. */
  notes: { input: z.object({}), output: z.array(noteSchema), tags: () => [NOTES_TAG] },
  /** Saves a note and returns it. */
  createNote: { input: newNoteSchema, output: noteSchema },
  /** Deletes the notes and their files for good. A note already gone counts as deleted, so a second call succeeds. */
  deleteNotes: { input: z.object({ noteIds: pickedIdsSchema }), output: z.object({}) },
  /** The notes, oldest first, as a brief whose media is uploaded into the project. Notes already gone are left out. */
  briefFor: { input: z.object({ noteIds: noteIdsSchema, projectId: z.string().min(1) }), output: briefSchema },
  /** Every draft notes wait in, each with its brief and its notes. */
  inDrafts: { input: z.object({}), output: z.array(inDraftSchema), tags: () => [NOTES_TAG] },
  /** Marks the notes as waiting in the draft. Notes already gone are left out; a note waiting elsewhere moves here. */
  putInDraft: { input: inDraftSchema, output: z.object({}) },
  /** The draft no longer holds the brief: its notes stop waiting there. A brief already gone is fine. */
  leaveDraft: { input: inDraftSchema.pick({ composerKey: true, brief: true }), output: z.object({}) },
  /**
   * The composer sent `text`, its draft as it stood: the notes waiting there whose brief it holds are
   * deleted with their files. Sending again deletes nothing more.
   */
  draftSent: { input: z.object({ composerKey: composerKeySchema, text: z.string() }), output: z.object({}) },
});

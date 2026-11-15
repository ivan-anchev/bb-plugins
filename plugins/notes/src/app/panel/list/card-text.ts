// The words a note shows on its row's two lines, and the thread it came from.
import { attachmentKind, type Attachment, type Note, type NoteBody } from "../../../contract.ts";

/**
 * Line 1: what the user wrote, else the passage they quoted, in quotation marks, else what they
 * attached ("2 screenshots").
 */
export function noteLine(note: Note): string {
  const body = oneLine(note.body.text);
  if (body !== "") return body;
  if (note.quote !== null) return `“${oneLine(note.quote.text)}”`;
  return attachmentsLabel(note.attachments);
}

/** Line 2: the title of the note's source thread, or null for a note with none. */
export function sourceTitle(note: Note): string | null {
  return sourceThread(note)?.title ?? null;
}

/**
 * The thread a note came from: the one its quote came from, else the first one it links with @, or
 * null for a note with neither.
 */
export function sourceThread(note: Note): { threadId: string; title: string } | null {
  if (note.quote !== null) return { threadId: note.quote.threadId, title: note.quote.threadTitle };
  return firstLinked(note.body);
}

/** A mention covers "@Title" in the text, so its title is the text after the "@". */
function firstLinked({ text, mentions }: NoteBody): { threadId: string; title: string } | null {
  const [first] = mentions;
  return first === undefined ? null : { threadId: first.threadId, title: text.slice(first.from + 1, first.to) };
}

/** "1 screenshot", "2 recordings", or "3 attachments" when images and videos are mixed. */
function attachmentsLabel(attachments: readonly Attachment[]): string {
  const kinds = new Set(attachments.map(({ mimeType }) => attachmentKind(mimeType)));
  const noun = kinds.size > 1 ? "attachment" : kinds.has("video") ? "recording" : "screenshot";
  return `${attachments.length} ${noun}${attachments.length === 1 ? "" : "s"}`;
}

/** A note written over several lines reads as one. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

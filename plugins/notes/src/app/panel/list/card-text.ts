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

/**
 * Line 2: the title of the thread the note came from: the one its quote came from, else the first
 * one it links with @, or null for a note with neither.
 */
export function sourceTitle(note: Note): string | null {
  if (note.quote !== null) return note.quote.threadTitle;
  return firstLinkedTitle(note.body);
}

function firstLinkedTitle({ text, mentions }: NoteBody): string | null {
  const [first] = mentions;
  return first === undefined ? null : text.slice(first.from + 1, first.to);
}

function attachmentsLabel(attachments: readonly Attachment[]): string {
  const kinds = new Set(attachments.map(({ mimeType }) => attachmentKind(mimeType)));
  const noun = kinds.size > 1 ? "attachment" : kinds.has("video") ? "recording" : "screenshot";
  return `${attachments.length} ${noun}${attachments.length === 1 ? "" : "s"}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

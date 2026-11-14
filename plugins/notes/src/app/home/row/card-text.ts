// The words a note shows on the card's two lines.
import type { Note, NoteBody } from "../../../contract.ts";

/** Line 1: what the user wrote, else the passage they quoted, in quotation marks. */
export function noteLine(note: Note): string {
  const body = oneLine(note.body.text);
  if (body !== "" || note.quote === null) return body;
  return `“${oneLine(note.quote.text)}”`;
}

/**
 * Line 2: the title of the thread the quote came from, else of the first thread the note links with
 * @, or null for a note with neither.
 */
export function sourceTitle(note: Note): string | null {
  return note.quote?.threadTitle ?? firstLinkedTitle(note.body);
}

/** A mention covers "@Title" in the text, so its label is the text after the "@". */
function firstLinkedTitle({ text, mentions }: NoteBody): string | null {
  const [first] = mentions;
  return first === undefined ? null : text.slice(first.from + 1, first.to);
}

/** A note written over several lines reads as one. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

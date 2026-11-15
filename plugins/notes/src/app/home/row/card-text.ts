// The words a note shows on the card's two lines.
import type { Note } from "../../../contract.ts";

/** Line 1: what the user wrote, else the passage they quoted, in quotation marks. */
export function noteLine(note: Note): string {
  const body = oneLine(note.body.text);
  if (body !== "" || note.quote === null) return body;
  return `“${oneLine(note.quote.text)}”`;
}

/** Line 2: the title of the thread the quote came from, or null for a note typed from scratch. */
export function sourceTitle(note: Note): string | null {
  return note.quote?.threadTitle ?? null;
}

/** A note written over several lines reads as one. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

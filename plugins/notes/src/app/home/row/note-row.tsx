// One note on the card, in two lines: the note itself, then the thread it came from.
import type { Note } from "../../../contract.ts";
import { FadingText } from "./fading-text.tsx";

export function NoteRow({ note }: { note: Note }) {
  return (
    <li className="nt-row">
      <FadingText className="nt-line1" text={oneLine(note.body.text)} />
      <FadingText className="nt-line2" text="No thread" />
    </li>
  );
}

/** A note written over several lines reads as one. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

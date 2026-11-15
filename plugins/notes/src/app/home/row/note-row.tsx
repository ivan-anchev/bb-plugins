// One note on the card, in two lines: the note itself, then the thread it came from, and at the end
// a fan of what it holds. Clicking the lines opens the note in the Spotlight.
import type { Note } from "../../../contract.ts";
import { spotlight } from "../../spotlight/spotlight-store.ts";
import { AttachmentFan } from "./attachment-fan.tsx";
import { noteLine, sourceTitle } from "./card-text.ts";
import { FadingText } from "./fading-text.tsx";

export function NoteRow({ note }: { note: Note }) {
  return (
    <li className="nt-row">
      <button type="button" className="nt-text" onClick={() => spotlight.view(note.id)}>
        <FadingText className="nt-line1" text={noteLine(note)} />
        <FadingText className="nt-line2" text={sourceTitle(note) ?? "No thread"} />
      </button>
      <AttachmentFan attachments={note.attachments} />
    </li>
  );
}

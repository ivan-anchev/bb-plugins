// One note on the card, in two lines: the note itself, then the thread it came from; a checkbox
// before them picks it for Start thread, and at the end a fan of what it holds, which picks it too.
// Clicking the lines opens the note in the Spotlight.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Note } from "../../../contract.ts";
import { spotlight } from "../../spotlight/spotlight-store.ts";
import { AttachmentFan } from "./attachment-fan.tsx";
import { noteLine, sourceTitle } from "./card-text.ts";
import { FadingText } from "./fading-text.tsx";

export function NoteRow({ note, selected, onToggle }: { note: Note; selected: boolean; onToggle(): void }) {
  const line = noteLine(note);
  return (
    <li className="nt-row">
      <button type="button" role="checkbox" aria-checked={selected} aria-label={line} className="nt-pick" onClick={onToggle}>
        <span className="nt-check">
          <Icon name="Check" aria-hidden />
        </span>
      </button>
      <button type="button" className="nt-text" onClick={() => spotlight.view(note.id)}>
        <FadingText className="nt-line1" text={line} />
        <FadingText className="nt-line2" text={sourceTitle(note) ?? "No thread"} />
      </button>
      <AttachmentFan attachments={note.attachments} onClick={onToggle} />
    </li>
  );
}

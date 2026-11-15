// One note in a panel's list, in two lines: the note itself, then the thread it came from. A checkbox
// before them picks it for New thread or Delete; at the end, a fan of what it holds. Clicking the lines or
// the fan opens the note in place under them.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { Note } from "../../../contract.ts";
import { NoteDetail } from "../detail/note-detail.tsx";
import { AttachmentFan } from "./attachment-fan.tsx";
import { noteLine, sourceTitle } from "./card-text.ts";
import { FadingText } from "./fading-text.tsx";

type NoteRowProps = {
  note: Note;
  picked: boolean;
  /** False while the picks are held (a delete on its way). */
  pickable: boolean;
  onPick(): void;
  open: boolean;
  onOpen(): void;
};

export function NoteRow({ note, picked, pickable, onPick, open, onOpen }: NoteRowProps) {
  const fresh = useIsFresh(note);
  const line = noteLine(note);
  return (
    <li className="nt-row" data-new={fresh || undefined}>
      <button type="button" role="checkbox" aria-checked={picked} aria-label={line} className="nt-pick" disabled={!pickable} onClick={onPick}>
        <span className="nt-check">
          <Icon name="Check" aria-hidden />
        </span>
      </button>
      <button type="button" className="nt-text" aria-expanded={open} onClick={onOpen}>
        <FadingText className="nt-line1" text={line} />
        <FadingText className="nt-line2" text={sourceTitle(note) ?? "No thread"} />
      </button>
      <AttachmentFan attachments={note.attachments} onClick={onOpen} />
      {open && <NoteDetail note={note} />}
    </li>
  );
}

// ------------------------------------------------------------------ layer 2

/** How long after it was saved a note's row still arrives highlighted. */
const FRESH_MS = 3000;

/**
 * A note saved moments ago, as its row first draws: it lands highlighted, in every list showing it.
 * why the clock at mount: the row draws once its list refreshes after the save, and only then.
 */
function useIsFresh(note: Note): boolean {
  const [fresh] = useState(() => Date.now() - note.createdAt < FRESH_MS);
  return fresh;
}

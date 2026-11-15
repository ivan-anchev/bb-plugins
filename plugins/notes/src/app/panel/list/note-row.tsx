// One note in a panel's list, in two lines: the note itself, then the thread it came from (and In
// draft while a composer's draft holds it), a fan of what it holds at the end. The row is its
// checkbox's label, so a click anywhere on it picks the note for New thread or Delete.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useState, type MouseEvent } from "react";
import type { Note } from "../../../contract.ts";
import { AttachmentFan } from "./attachment-fan.tsx";
import { noteLine, sourceTitle } from "./card-text.ts";
import { FadingText } from "./fading-text.tsx";

type NoteRowProps = {
  note: Note;
  picked: boolean;
  /** False while the picks are held (a delete or a start on its way). */
  pickable: boolean;
  /** A composer's draft holds the note's brief: sending it deletes the note. */
  inDraft: boolean;
  onPick(): void;
};

export function NoteRow({ note, picked, pickable, inDraft, onPick }: NoteRowProps) {
  const fresh = useIsFresh(note);
  const line = noteLine(note);
  return (
    <li className="nt-row" data-new={fresh || undefined}>
      {/* why a label, not a button stretched over the row: its text stays selectable, and a disabled
          checkbox (the picks held) makes the whole row inert with it. */}
      <label className="nt-row-label" onClick={keepSelection}>
        <input type="checkbox" className="nt-pick" aria-label={line} checked={picked} disabled={!pickable} onChange={onPick} />
        <span className="nt-check" aria-hidden>
          <Icon name="Check" />
        </span>
        <span className="nt-text">
          <FadingText className="nt-line1" text={line} />
          <span className="nt-line2">
            <FadingText className="nt-source" text={sourceTitle(note) ?? "No thread"} />
            {inDraft && <span className="nt-in-draft">In draft</span>}
          </span>
        </span>
        <AttachmentFan attachments={note.attachments} />
      </label>
    </li>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * A drag that selects some of the row's text ends in a click on the row: it copies, so it doesn't
 * tick. A press on the checkbox itself (Space) always does.
 */
function keepSelection(event: MouseEvent<HTMLLabelElement>): void {
  if (event.target !== event.currentTarget.control && !document.getSelection()!.isCollapsed) event.preventDefault();
}

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

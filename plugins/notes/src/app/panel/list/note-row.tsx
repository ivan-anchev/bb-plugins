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

function keepSelection(event: MouseEvent<HTMLLabelElement>): void {
  if (event.target !== event.currentTarget.control && !document.getSelection()!.isCollapsed) event.preventDefault();
}

const FRESH_MS = 3000;

function useIsFresh(note: Note): boolean {
  const [fresh] = useState(() => Date.now() - note.createdAt < FRESH_MS);
  return fresh;
}

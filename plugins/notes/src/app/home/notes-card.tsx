// homepageSection: Notes. Two-line rows (the note; its source thread), 4 of them, then "N more".
// Look from prototypes/notes-card-fan.html, variant Symmetric.
import { experimental_Icon as Icon, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { notesContract, type Note } from "../../contract.ts";
import { spotlight } from "../spotlight/spotlight-store.ts";
import { NOTE_ICON } from "../ui/note-icon.tsx";
import { NoteRow } from "./row/note-row.tsx";

/** Rows shown before "N more". */
const SHOWN = 4;

export function NotesCard() {
  const notes = experimental_useRpcQuery({ contract: notesContract, method: "notes", input: {} });
  const list = notes.data;
  return (
    <section className="nt-card" aria-label="Notes">
      <header className="nt-head">
        <Icon name={NOTE_ICON} className="nt-icon" aria-hidden />
        <span>Notes</span>
        {list !== undefined && list.length > 0 && <span className="nt-count">{list.length}</span>}
      </header>
      {/* A failed read keeps the last notes in `data` and says why beside them. */}
      {notes.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t read notes: {notes.error.message}
        </p>
      )}
      {list !== undefined && (list.length === 0 ? <EmptyLine /> : <NoteList notes={list} />)}
      <footer className="nt-foot nt-caption">
        {list !== undefined && list.length > 0 && <span>Pick notes to start a thread</span>}
        <button type="button" className="nt-link" onClick={() => spotlight.compose(null)}>
          New note<kbd className="nt-foot-kbd">⇧⌘J</kbd>
        </button>
      </footer>
    </section>
  );
}

// ------------------------------------------------------------------ layer 2

function NoteList({ notes }: { notes: readonly Note[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? notes : notes.slice(0, SHOWN);
  return (
    <ul className="nt-list">
      {shown.map((note) => (
        <NoteRow key={note.id} note={note} />
      ))}
      {notes.length > SHOWN && (
        <li>
          <button type="button" className="nt-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            <Icon name={expanded ? "ChevronUp" : "ChevronDown"} className="nt-icon" aria-hidden />
            {expanded ? "Show fewer" : `${notes.length - SHOWN} more`}
          </button>
        </li>
      )}
    </ul>
  );
}

function EmptyLine() {
  return (
    <p className="nt-caption nt-empty">
      Nothing saved yet. Select text in a reply and choose <b>Add to notes</b>, or press ⇧⌘J.
    </p>
  );
}

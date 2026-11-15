// homepageSection: Notes. Two-line rows (the note; its source thread), 4 of them, then "N more".
// Pick notes with their checkboxes, and Start thread fills bb's composer above with them.
// Look from prototypes/notes-card-fan.html, variant Symmetric.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRef, useState } from "react";
import type { Note } from "../../contract.ts";
import { spotlight } from "../spotlight/spotlight-store.ts";
import { useHoldEscape } from "../ui/use-hold-escape.ts";
import { NOTE_ICON } from "../ui/note-icon.tsx";
import { useNotes } from "../use-notes.ts";
import { CARD_HEADER, focusCardHeader } from "./card-focus.ts";
import { NoteRow } from "./row/note-row.tsx";
import { useStartThread } from "./use-start-thread.ts";

/** Rows shown before "N more". */
const SHOWN = 4;

export function NotesCard() {
  const notes = useNotes();
  const list = notes.data;
  const selection = useSelection(list ?? []);
  const start = useStartThread();
  return (
    <section className="nt-card" aria-label="Notes">
      <header className="nt-head" {...CARD_HEADER}>
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
      {list !== undefined && (list.length === 0 ? <EmptyLine /> : <NoteList notes={list} selection={selection} />)}
      <StartProblems start={start} />
      {selection.ids.length === 0 ? (
        <IdleFooter hasNotes={list !== undefined && list.length > 0} />
      ) : (
        <PickingFooter count={selection.ids.length} start={start} onStart={() => start.run(selection.ids, selection.clear)} onClear={selection.clear} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ layer 2

type Selection = ReturnType<typeof useSelection>;
type StartThread = ReturnType<typeof useStartThread>;

/**
 * The reader's picks. why intersected with the list on every render: a note deleted in the
 * Spotlight or archived in another window must drop out of the count and the brief.
 */
function useSelection(notes: readonly Note[]) {
  const [picked, setPicked] = useState<ReadonlySet<Note["id"]>>(new Set());
  return {
    ids: notes.filter(({ id }) => picked.has(id)).map(({ id }) => id),
    has: (id: Note["id"]) => picked.has(id),
    toggle: (id: Note["id"]) => setPicked((current) => toggled(current, id)),
    clear: () => setPicked(new Set()),
  };
}

function toggled(set: ReadonlySet<Note["id"]>, id: Note["id"]): ReadonlySet<Note["id"]> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

function NoteList({ notes, selection }: { notes: readonly Note[]; selection: Selection }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? notes : notes.slice(0, SHOWN);
  return (
    <ul className="nt-list">
      {shown.map((note) => (
        <NoteRow key={note.id} note={note} selected={selection.has(note.id)} onToggle={() => selection.toggle(note.id)} />
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

/** Why the last Start thread fell short: the brief failed, or the notes went in but stayed on the card. */
function StartProblems({ start }: { start: StartThread }) {
  const { error, retryArchive } = start;
  return (
    <>
      {error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t start a thread: {error}
        </p>
      )}
      {retryArchive !== null && (
        <p className="nt-caption nt-error" role="status">
          Notes are in the composer, but archiving them failed.{" "}
          {/* why the header after: this button leaves once the archive succeeds. */}
          <button type="button" className="nt-link nt-retry" disabled={start.isPending} onClick={() => retryArchive().then(focusCardHeader, () => undefined)}>
            Try again
          </button>
        </p>
      )}
    </>
  );
}

function IdleFooter({ hasNotes }: { hasNotes: boolean }) {
  return (
    <footer className="nt-foot nt-caption">
      {hasNotes && <span>Pick notes to start a thread</span>}
      <button type="button" className="nt-link nt-end" onClick={() => spotlight.compose(null)}>
        New note<kbd className="nt-foot-kbd">⇧⌘J</kbd>
      </button>
    </footer>
  );
}

/** Shown while notes are picked. Esc anywhere on the page clears the picks, as Clear does. */
function PickingFooter({ count, start, onStart, onClear }: { count: number; start: StartThread; onStart(): void; onClear(): void }) {
  const footer = useRef<HTMLElement>(null);
  // why the header after: this footer leaves with the picks, so focus inside it would be lost. Focus
  // elsewhere (a row, the composer) stays where it is.
  const clear = () => {
    const hadFocus = footer.current?.contains(document.activeElement) ?? false;
    onClear();
    if (hadFocus) focusCardHeader();
  };
  // why: bb's own Esc leaves the page, and the picks with it.
  useHoldEscape(true, clear);
  return (
    <footer ref={footer} className="nt-foot nt-caption">
      <span>{count} selected</span>
      <span aria-hidden>·</span>
      <button type="button" className="nt-link" onClick={clear}>
        Clear
      </button>
      <button type="button" className="nt-go" disabled={!start.ready || start.isPending} onClick={onStart}>
        Start thread
      </button>
    </footer>
  );
}

function EmptyLine() {
  return (
    <p className="nt-caption nt-empty">
      Nothing saved yet. Select text in a reply and choose <b>Add to notes</b>, or press ⇧⌘J.
    </p>
  );
}

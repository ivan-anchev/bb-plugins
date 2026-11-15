// The Notes panel, one component in two hosts: the homepage card and the sidebar's popover. Header
// (icon, "Notes", count; the popover adds a close button), the scrolling list, a footer that deletes
// ticked notes or turns them into a thread, and at the bottom the popover's composer. Look from
// prototypes/notes-tray.html, Popover, and notes-input.html, Composer.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRef, type ReactNode, type RefObject } from "react";
import type { useNotes } from "../use-notes.ts";
import { NOTE_ICON } from "../ui/note-icon.tsx";
import { useHandOffFocus } from "../ui/use-hand-off-focus.ts";
import { NoteList } from "./list/note-list.tsx";
import { useDeleteNotes } from "./use-delete-notes.ts";
import type { Picks } from "./use-picks.ts";
import { useStartThread } from "./use-start-thread.ts";

type NotesPanelProps = {
  notes: ReturnType<typeof useNotes>;
  /** The host's own picks: the card and the popover each keep theirs. */
  picks: Picks;
  /** The popover's composer, at the bottom. */
  form?: ReactNode;
  /** The popover's close button. */
  onClose?(): void;
  /** The card's "New note" link, in the footer it shows while nothing is picked. */
  onNewNote?(): void;
  /** After Start thread filled the composer. */
  onStarted?(): void;
  /**
   * The popover: whether the opening that ran Start thread is still on screen. Once it is not, the
   * finished start still fills the draft, but neither focuses the composer nor calls `onStarted`.
   */
  isCurrent?(): boolean;
};

export function NotesPanel({ notes, picks, form, onClose, onNewNote, onStarted, isCurrent = () => true }: NotesPanelProps) {
  const header = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useStartThread();
  const remove = useDeleteNotes();
  const list = notes.data;
  const picking = picks.ids.length > 0;
  return (
    <section className="nt-panel" data-picking={picking || undefined} aria-label="Notes">
      <PanelHeader ref={header} count={list?.length ?? 0} onClose={onClose} />
      {/* A failed read keeps the last notes in `data` and says why beside them. */}
      {notes.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t read notes: {notes.error.message}
        </p>
      )}
      <NoteList ref={box} notes={list} picks={picks} empty={form === undefined ? <EmptyCard /> : <EmptyPopover />} />
      {picking && remove.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t delete: {remove.error}
        </p>
      )}
      {picking && <StartProblem start={start} />}
      {picking ? (
        <PickingFooter
          picks={picks}
          start={start}
          busy={start.isPending || picks.held}
          focusAfter={header}
          onStart={() =>
            start.run(picks.ids, {
              onFilled: () => {
                picks.clear();
                onStarted?.();
              },
              isCurrent,
            })
          }
          onDelete={() =>
            picks.submit(
              // why before the picks clear, and why `?.`: focus is out of the footer before it leaves with
              // them, and the popover may have closed while the notes were deleting.
              remove.run(picks.ids, () => box.current?.focus()),
            )
          }
        />
      ) : (
        onNewNote !== undefined && <IdleFooter hasNotes={list !== undefined && list.length > 0} onNewNote={onNewNote} />
      )}
      {form}
    </section>
  );
}

// ------------------------------------------------------------------ layer 2

type StartThread = ReturnType<typeof useStartThread>;

function PanelHeader({ ref, count, onClose }: { ref: RefObject<HTMLElement | null>; count: number; onClose?(): void }) {
  return (
    // why focusable by script: the footer that leaves with the picks hands focus here.
    <header ref={ref} className="nt-head" tabIndex={-1}>
      <Icon name={NOTE_ICON} className="nt-icon" aria-hidden />
      <span>Notes</span>
      {count > 0 && <span className="nt-count">{count}</span>}
      {onClose !== undefined && (
        <button type="button" className="nt-close" aria-label="Close notes" onClick={onClose}>
          <Icon name="X" aria-hidden />
        </button>
      )}
    </header>
  );
}

/** Why the picked notes can't go anywhere yet: the last failure, or no composer on this screen. */
function StartProblem({ start }: { start: StartThread }) {
  const problem = start.error === null ? start.unavailable : `Couldn’t start the thread: ${start.error}`;
  if (problem === null) return null;
  return (
    <p className="nt-caption" data-error={start.error !== null || undefined} role="status">
      {problem}
    </p>
  );
}

function IdleFooter({ hasNotes, onNewNote }: { hasNotes: boolean; onNewNote(): void }) {
  return (
    <footer className="nt-foot nt-caption">
      {hasNotes && <span>Tick notes to start a thread</span>}
      <button type="button" className="nt-link nt-end" onClick={onNewNote}>
        New note<kbd className="nt-kbd">⇧⌘J</kbd>
      </button>
    </footer>
  );
}

type PickingFooterProps = {
  picks: Picks;
  start: StartThread;
  /** A delete or a start is on its way: every control waits for it. */
  busy: boolean;
  focusAfter: RefObject<HTMLElement | null>;
  onStart(): void;
  onDelete(): void;
};

/**
 * Shown while notes are picked: "N selected · Clear", then Delete and the button. With a narrow host,
 * Delete and the button wrap together under the count.
 */
function PickingFooter({ picks, start, busy, focusAfter, onStart, onDelete }: PickingFooterProps) {
  const footer = useRef<HTMLElement>(null);
  useHandOffFocus(footer, focusAfter);
  return (
    <footer ref={footer} className="nt-foot nt-picks nt-caption">
      <span>{picks.ids.length} selected</span>
      <span aria-hidden>·</span>
      <button type="button" className="nt-link" disabled={busy} onClick={picks.clear}>
        Clear
      </button>
      <span className="nt-picks-acts">
        {/* why no confirm step: the user chose one click; the footer's count says what goes. */}
        <button type="button" className="nt-link" disabled={busy} onClick={onDelete}>
          Delete
        </button>
        <button type="button" className="nt-go" disabled={busy || start.unavailable !== null || !start.ready} onClick={onStart}>
          {start.label}
        </button>
      </span>
    </footer>
  );
}

function EmptyCard() {
  return (
    <>
      Nothing saved yet. Select text in a reply and choose <b>Add to notes</b>, or press ⇧⌘J.
    </>
  );
}

function EmptyPopover() {
  return (
    <>
      Nothing saved yet. Write one below, or select text in a reply and choose <b>Add to notes</b>.
    </>
  );
}

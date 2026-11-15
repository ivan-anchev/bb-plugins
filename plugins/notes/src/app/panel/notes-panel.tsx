// The Notes panel, one component in two hosts: the homepage card and the sidebar's popover. Header
// (icon, "Notes", count; the popover adds a close button), the popover's form, the scrolling list,
// and a footer that turns ticked notes into a thread. Look from prototypes/notes-tray.html, Popover.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRef, type ReactNode, type RefObject } from "react";
import type { useNotes } from "../use-notes.ts";
import { NOTE_ICON } from "../ui/note-icon.tsx";
import { useHandOffFocus } from "../ui/use-hand-off-focus.ts";
import { NoteList } from "./list/note-list.tsx";
import type { Picks } from "./use-picks.ts";
import { useStartThread } from "./use-start-thread.ts";

type NotesPanelProps = {
  notes: ReturnType<typeof useNotes>;
  /** The host's own picks: the card and the popover each keep theirs. */
  picks: Picks;
  /** The popover's inline form, above the list. */
  form?: ReactNode;
  /** The popover's close button. */
  onClose?(): void;
  /** The card's "New note" link. */
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
  const start = useStartThread();
  const list = notes.data;
  const picking = picks.ids.length > 0;
  return (
    <section className="nt-panel" data-picking={picking || undefined} aria-label="Notes">
      <PanelHeader ref={header} count={list?.length ?? 0} onClose={onClose} />
      {form}
      {/* A failed read keeps the last notes in `data` and says why beside them. */}
      {notes.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t read notes: {notes.error.message}
        </p>
      )}
      <NoteList notes={list} picks={picks} empty={form === undefined ? <EmptyCard /> : <EmptyPopover />} />
      {picking && <StartProblem start={start} />}
      {picking ? (
        <PickingFooter
          count={picks.ids.length}
          start={start}
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
          onClear={picks.clear}
        />
      ) : (
        <IdleFooter hasNotes={list !== undefined && list.length > 0} onNewNote={onNewNote} />
      )}
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

function IdleFooter({ hasNotes, onNewNote }: { hasNotes: boolean; onNewNote?(): void }) {
  return (
    <footer className="nt-foot nt-caption">
      {hasNotes && <span>Tick notes to start a thread</span>}
      {onNewNote !== undefined && (
        <button type="button" className="nt-link nt-end" onClick={onNewNote}>
          New note<kbd className="nt-kbd">⇧⌘J</kbd>
        </button>
      )}
    </footer>
  );
}

type PickingFooterProps = { count: number; start: StartThread; focusAfter: RefObject<HTMLElement | null>; onStart(): void; onClear(): void };

/** Shown while notes are picked. With a narrow host, the button wraps under the count. */
function PickingFooter({ count, start, focusAfter, onStart, onClear }: PickingFooterProps) {
  const footer = useRef<HTMLElement>(null);
  useHandOffFocus(footer, focusAfter);
  return (
    <footer ref={footer} className="nt-foot nt-picks nt-caption">
      <span>{count} selected</span>
      <span aria-hidden>·</span>
      <button type="button" className="nt-link" onClick={onClear}>
        Clear
      </button>
      <button type="button" className="nt-go" disabled={start.unavailable !== null || !start.ready || start.isPending} onClick={onStart}>
        {start.label}
      </button>
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
      Nothing saved yet. Write one above, or select text in a reply and choose <b>Add to notes</b>.
    </>
  );
}

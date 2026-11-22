import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRef, type ReactNode, type RefObject } from "react";
import { useInDrafts, type useNotes } from "../use-notes.ts";
import { NOTE_ICON } from "../ui/note-icon.tsx";
import { useHandOffFocus } from "../ui/use-hand-off-focus.ts";
import { NoteList } from "./list/note-list.tsx";
import { StartButton } from "./start/start-button.tsx";
import { useStarts } from "./start/use-starts.ts";
import { useDeleteNotes } from "./use-delete-notes.ts";
import type { Picks } from "./use-picks.ts";

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
  /** After a start filled the composer. */
  onStarted?(): void;
  /**
   * The popover: whether the opening that ran a start is still on screen. Once it is not, the
   * finished start still fills the draft, but neither focuses the composer nor calls `onStarted`.
   */
  isCurrent?(): boolean;
};

export function NotesPanel({ notes, picks, form, onClose, onNewNote, onStarted, isCurrent = () => true }: NotesPanelProps) {
  const header = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useStarts({ picks, waitFocus: box, isCurrent, onStarted });
  const remove = useDeleteNotes();
  const drafts = useInDrafts();
  const list = notes.data;
  const picking = picks.ids.length > 0;
  return (
    <section className="nt-panel" data-picking={picking || undefined} aria-label="Notes" onKeyDownCapture={start.onKeyDownCapture}>
      <PanelHeader ref={header} count={list?.length ?? 0} onClose={onClose} />
      {notes.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t read notes: {notes.error.message}
        </p>
      )}
      {drafts.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t read which notes are in a draft: {drafts.error.message}{" "}
          <button type="button" className="nt-link" onClick={() => void drafts.refetch()}>
            Retry
          </button>
        </p>
      )}
      <NoteList
        ref={box}
        notes={list}
        inDraft={new Set(drafts.data?.flatMap(({ noteIds }) => noteIds))}
        picks={picks}
        empty={form === undefined ? <EmptyCard /> : <EmptyPopover />}
      />
      {picking && remove.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t delete: {remove.error}
        </p>
      )}
      {picking && start.error !== null && (
        <p className="nt-caption nt-error" role="status">
          Couldn’t start the thread: {start.error}
        </p>
      )}
      {picking ? (
        <PickingFooter
          picks={picks}
          focusAfter={header}
          start={<StartButton disabled={picks.held} newThread={start.newThread} thisThread={start.thisThread} />}
          onDelete={() => {
            box.current!.focus();
            picks.submit(remove.run(picks.ids));
          }}
        />
      ) : (
        onNewNote !== undefined && <IdleFooter hasNotes={list !== undefined && list.length > 0} onNewNote={onNewNote} />
      )}
      {form}
    </section>
  );
}

function PanelHeader({ ref, count, onClose }: { ref: RefObject<HTMLElement | null>; count: number; onClose?(): void }) {
  return (
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
  focusAfter: RefObject<HTMLElement | null>;
  start: ReactNode;
  onDelete(): void;
};

function PickingFooter({ picks, focusAfter, start, onDelete }: PickingFooterProps) {
  const footer = useRef<HTMLElement>(null);
  useHandOffFocus(footer, focusAfter);
  return (
    <footer ref={footer} className="nt-foot nt-picks nt-caption">
      <span>{picks.ids.length} selected</span>
      <span aria-hidden>·</span>
      <button type="button" className="nt-link" disabled={picks.held} onClick={picks.clear}>
        Clear
      </button>
      <span className="nt-picks-acts">
        <button type="button" className="nt-link" disabled={picks.held} onClick={onDelete}>
          Delete
        </button>
        {start}
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

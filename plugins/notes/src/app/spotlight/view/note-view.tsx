// The Spotlight's view mode: a saved note, read-only (notes are not edited), with Delete. Same
// frame as compose: the quoted passage with its source chip, the note's words, then its media.
import { experimental_Icon as Icon, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { Close, Content, Title } from "@radix-ui/react-dialog";
import { Fragment, useRef, type RefObject } from "react";
import { toast } from "sonner"; // runtime-shimmed to bb's own toast
import { notesContract, type Note, type NoteBody } from "../../../contract.ts";
import { focusCardHeader } from "../../home/card-focus.ts";
import { NOTE_ICON } from "../../ui/note-icon.tsx";
import { PORTAL_SCOPE } from "../../ui/portal-scope.ts";
import { useReturnFocus } from "../../ui/return-focus.ts";
import { QuoteBlock } from "../quote-block.tsx";
import { bodyParts } from "./body-parts.ts";
import { NoteMedia } from "./note-media.tsx";

/** `readError`: the notes list failed its latest read, so `note` may be stale; the view says so. */
export function NoteView({ note, readError, onDeleted }: { note: Note; readError: string | null; onDeleted(): void }) {
  const remove = useDelete(note.id, onDeleted);
  const content = useRef<HTMLDivElement>(null);
  const closeFocus = useCloseFocus(remove.deleted);
  return (
    <Content
      {...PORTAL_SCOPE}
      ref={content}
      className="nt-spot"
      aria-describedby={undefined}
      // why the dialog itself: there is nothing to type, so focus starts at the top of the note, not
      // on the source chip or a button.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        content.current!.focus();
      }}
      onCloseAutoFocus={closeFocus}
    >
      <Title className="nt-spot-title">
        <Icon name={NOTE_ICON} className="nt-spot-icon" aria-hidden />
        Note
        <kbd className="nt-kbd nt-end">esc</kbd>
      </Title>
      {readError !== null && (
        <p className="nt-spot-error" role="status">
          Couldn’t read notes: {readError}
        </p>
      )}
      {note.quote !== null && <QuoteBlock quote={note.quote} whole />}
      {note.body.text !== "" && <BodyText body={note.body} />}
      <NoteMedia attachments={note.attachments} />
      {remove.error !== null && (
        <p className="nt-spot-error" role="alert">
          Couldn’t delete: {remove.error}
        </p>
      )}
      <div className="nt-spot-foot">
        <Close asChild>
          <button type="button" className="nt-button nt-end">
            Close
          </button>
        </Close>
        <button type="button" className="nt-button" data-danger="" disabled={remove.isPending} onClick={remove.run}>
          Delete
        </button>
      </div>
    </Content>
  );
}

// ------------------------------------------------------------------ layer 2

/** The note's words, each linked thread's "@Title" marked. Long words scroll, so Tab reaches them. */
function BodyText({ body }: { body: NoteBody }) {
  return (
    <p className="nt-view-text" tabIndex={0}>
      {bodyParts(body).map((part, index) =>
        part.threadId === null ? (
          <Fragment key={index}>{part.text}</Fragment>
        ) : (
          <mark key={index} className="nt-mention">
            {part.text}
          </mark>
        ),
      )}
    </p>
  );
}

/**
 * Delete sends once; success closes and toasts, a failure keeps the view open and says why.
 * `deleted` is a ref, not state: closing unmounts the view in the same update, and the dialog
 * reads it once it has unmounted.
 */
function useDelete(id: Note["id"], onDeleted: () => void) {
  const remove = experimental_useRpcMutation({ contract: notesContract, method: "deleteNote" });
  const deleted = useRef(false);
  const run = () => {
    remove.mutate({ id }).then(
      () => {
        deleted.current = true;
        onDeleted();
        toast.success("Note deleted");
      },
      // why swallowed: the hook keeps the failure in `remove.error`, which the view shows.
      () => undefined,
    );
  };
  return { deleted, isPending: remove.isPending, error: remove.error?.message ?? null, run };
}

/**
 * Where focus goes when the view closes: back to the row that opened it, or to the card's header
 * once that note is gone (deleted here, so its row is about to leave the card; or deleted elsewhere,
 * so its row already has).
 */
function useCloseFocus(deleted: RefObject<boolean>) {
  const returnFocus = useReturnFocus(focusCardHeader);
  return (event: Event) => {
    if (!deleted.current) return returnFocus(event);
    event.preventDefault();
    focusCardHeader();
  };
}

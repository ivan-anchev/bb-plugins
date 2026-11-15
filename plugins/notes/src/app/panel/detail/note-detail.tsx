// A note opened in place under its row: the quoted passage with its source chip, the note's words
// with each linked thread marked, its media, then Open thread. Notes are not edited; they are deleted
// from the picking footer.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Fragment, useLayoutEffect, useRef } from "react";
import type { Note, NoteBody } from "../../../contract.ts";
import { QuoteBlock } from "../../quote-block.tsx";
import { sourceThread } from "../list/card-text.ts";
import { bodyParts } from "./body-parts.ts";
import { NoteMedia } from "./note-media.tsx";

export function NoteDetail({ note }: { note: Note }) {
  const detail = useRef<HTMLDivElement>(null);
  // why: a note opened near the bottom of the list would open out of sight, under the fade. why the
  // braces: Chromium's scrollIntoView now returns a promise, which React would take for a cleanup.
  useLayoutEffect(() => {
    detail.current!.scrollIntoView({ block: "nearest" });
  }, []);
  const source = sourceThread(note);
  const navigate = useBbNavigate();
  return (
    <div ref={detail} className="nt-detail">
      {/* A long note scrolls inside its own box, so Tab reaches it to scroll by keyboard. A note of
          files alone has no words to show. */}
      {(note.quote !== null || note.body.text !== "") && (
        <div className="nt-full" tabIndex={0}>
          {note.quote !== null && <QuoteBlock quote={note.quote} whole />}
          {note.body.text !== "" && <BodyText body={note.body} />}
        </div>
      )}
      <NoteMedia attachments={note.attachments} />
      {source !== null && (
        <div className="nt-acts">
          <button type="button" className="nt-link" onClick={() => navigate.toThread(source.threadId)}>
            Open thread
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/** The note's words, each linked thread's "@Title" marked. */
function BodyText({ body }: { body: NoteBody }) {
  return (
    <p className="nt-body">
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

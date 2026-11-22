import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import type { Note } from "../../../contract.ts";
import type { Picks } from "../use-picks.ts";
import { NoteRow } from "./note-row.tsx";

type NoteListProps = {
  /** The scrolling box, where the panel sends focus while a delete or a start runs. */
  ref: RefObject<HTMLDivElement | null>;
  /** Undefined until the first read, when the box stays empty. */
  notes: readonly Note[] | undefined;
  /** The notes a composer's draft holds. */
  inDraft: ReadonlySet<Note["id"]>;
  picks: Picks;
  /** What a list with none says. */
  empty: ReactNode;
};

export function NoteList({ ref: box, notes, inDraft, picks, empty }: NoteListProps) {
  useScrollEdges(box);
  useTopOnNewFirst(box, notes?.[0]?.id);
  return (
    <div ref={box} className="nt-scroll" tabIndex={0}>
      <ul className="nt-list">
        {notes?.length === 0 && <li className="nt-caption nt-empty">{empty}</li>}
        {notes?.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            picked={picks.has(note.id)}
            pickable={!picks.held}
            inDraft={inDraft.has(note.id)}
            onPick={() => picks.toggle(note.id)}
          />
        ))}
      </ul>
    </div>
  );
}

const EDGE = 2;

function useScrollEdges(box: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const element = box.current!;
    const mark = () => {
      element.toggleAttribute("data-top", element.scrollTop > EDGE);
      element.toggleAttribute("data-bottom", element.scrollTop + element.clientHeight < element.scrollHeight - EDGE);
    };
    mark();
    element.addEventListener("scroll", mark, { passive: true });
    const observer = new ResizeObserver(mark);
    observer.observe(element);
    observer.observe(element.firstElementChild!);
    return () => {
      element.removeEventListener("scroll", mark);
      observer.disconnect();
    };
  }, [box]);
}

function useTopOnNewFirst(box: RefObject<HTMLDivElement | null>, firstId: Note["id"] | undefined): void {
  useLayoutEffect(() => {
    box.current!.scrollTop = 0;
  }, [box, firstId]);
}

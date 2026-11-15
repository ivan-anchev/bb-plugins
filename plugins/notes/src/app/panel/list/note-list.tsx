// A panel's notes, newest first, scrolling inside a box whose height comes from its host (the
// card's row, the popover's frame), never from how many notes there are. Its edges fade only where
// there is more to scroll to.
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
    // why a Tab stop: the keyboard scrolls only the focused box.
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

// ------------------------------------------------------------------ layer 2

/** How far from an edge still counts as at it, so subpixel scrolling never leaves a sliver of fade. */
const EDGE = 2;

/**
 * Marks the box `data-top` / `data-bottom` while there is more above / below; the CSS fades those
 * edges. Measured on scroll, and whenever the box or its list resizes (notes added or deleted).
 */
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

/** When the top note changes, as a note just saved lands there, the list scrolls back up to show it. */
function useTopOnNewFirst(box: RefObject<HTMLDivElement | null>, firstId: Note["id"] | undefined): void {
  useLayoutEffect(() => {
    box.current!.scrollTop = 0;
  }, [box, firstId]);
}

// A panel's notes, newest first, scrolling inside a box whose height comes from its host (the
// card's row, the popover's frame), never from how many notes there are. Its edges fade only where
// there is more to scroll to. One note at a time is open in place.
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Note } from "../../../contract.ts";
import type { Picks } from "../use-picks.ts";
import { NoteRow } from "./note-row.tsx";

/** `notes`: undefined until the first read, when the box stays empty. `empty`: what a list with none says. */
export function NoteList({ notes, picks, empty }: { notes: readonly Note[] | undefined; picks: Picks; empty: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<Note["id"] | null>(null);
  useScrollEdges(box);
  useTopOnNewFirst(box, notes?.[0]?.id);
  return (
    // why a Tab stop: the keyboard scrolls only the focused box. A row deleted with focus in it also
    // hands focus here.
    <div ref={box} className="nt-scroll" tabIndex={0}>
      <ul className="nt-list">
        {notes?.length === 0 && <li className="nt-caption nt-empty">{empty}</li>}
        {notes?.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            picked={picks.has(note.id)}
            onPick={() => picks.toggle(note.id)}
            open={openId === note.id}
            onOpen={() => setOpenId(openId === note.id ? null : note.id)}
            focusAfter={box}
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
 * edges. Measured on scroll, and whenever the box or its list resizes (notes added, a row opened).
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

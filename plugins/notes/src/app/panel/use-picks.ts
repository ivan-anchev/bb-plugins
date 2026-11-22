import { useState } from "react";
import type { Note } from "../../contract.ts";

export type Picks = ReturnType<typeof usePicks>;

/**
 * why intersected with the list on every render: a note deleted elsewhere (or sent) must drop out
 * of the count and the brief.
 */
export function usePicks(notes: readonly Note[]) {
  const [picked, setPicked] = useState<ReadonlySet<Note["id"]>>(new Set());
  const [held, setHeld] = useState(false);
  return {
    ids: notes.filter(({ id }) => picked.has(id)).map(({ id }) => id),
    has: (id: Note["id"]) => picked.has(id),
    toggle: (id: Note["id"]) => {
      if (!held) setPicked((current) => toggled(current, id));
    },
    clear: () => {
      if (!held) setPicked(new Set());
    },
    held,
    submit: (work: Promise<boolean>) => {
      setHeld(true);
      void work.then((done) => {
        if (done) setPicked(new Set());
        setHeld(false);
      });
    },
  };
}

function toggled(set: ReadonlySet<Note["id"]>, id: Note["id"]): ReadonlySet<Note["id"]> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

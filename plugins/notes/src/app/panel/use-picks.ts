// The notes a panel has ticked for Start thread or Delete. Each host (the card, the popover) keeps its
// own.
import { useState } from "react";
import type { Note } from "../../contract.ts";

export type Picks = ReturnType<typeof usePicks>;

/**
 * why intersected with the list on every render: a note deleted or archived elsewhere must drop out
 * of the count and the brief.
 */
export function usePicks(notes: readonly Note[]) {
  const [picked, setPicked] = useState<ReadonlySet<Note["id"]>>(new Set());
  const [held, setHeld] = useState(false);
  return {
    ids: notes.filter(({ id }) => picked.has(id)).map(({ id }) => id),
    has: (id: Note["id"]) => picked.has(id),
    /** Ticks or unticks a note, unless the picks are held. */
    toggle: (id: Note["id"]) => {
      if (!held) setPicked((current) => toggled(current, id));
    },
    /** Unticks every note, unless the picks are held. */
    clear: () => {
      if (!held) setPicked(new Set());
    },
    /** The picks are on their way somewhere: no tick, Clear or Esc changes them until it settles. */
    held,
    /**
     * Holds the picks while `work` runs, so they stay what was submitted, then clears them if it went
     * through (resolved true); a failure keeps them. `work` never rejects.
     */
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

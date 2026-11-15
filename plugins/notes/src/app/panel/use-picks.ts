// The notes a panel has ticked for Start thread. Each host (the card, the popover) keeps its own.
import { useState } from "react";
import type { Note } from "../../contract.ts";

export type Picks = ReturnType<typeof usePicks>;

/**
 * why intersected with the list on every render: a note deleted or archived elsewhere must drop out
 * of the count and the brief.
 */
export function usePicks(notes: readonly Note[]) {
  const [picked, setPicked] = useState<ReadonlySet<Note["id"]>>(new Set());
  return {
    ids: notes.filter(({ id }) => picked.has(id)).map(({ id }) => id),
    has: (id: Note["id"]) => picked.has(id),
    toggle: (id: Note["id"]) => setPicked((current) => toggled(current, id)),
    clear: () => setPicked(new Set()),
  };
}

function toggled(set: ReadonlySet<Note["id"]>, id: Note["id"]): ReadonlySet<Note["id"]> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

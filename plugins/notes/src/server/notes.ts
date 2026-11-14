// What happens when a note is written: it gets an id and a time, lands in the store, and every
// open card is told to read again.
import { randomUUID } from "node:crypto";
import { noteIdSchema, type NewNote, type Note } from "../contract.ts";
import type { Store } from "./store.ts";

type Deps = { store: Store; now: () => number; onChange: () => void };

export function createNotes({ store, now, onChange }: Deps) {
  return {
    create(input: NewNote): Note {
      const note: Note = { id: noteIdSchema.parse(`note_${randomUUID()}`), createdAt: now(), quote: input.quote, body: input.body };
      store.insert(note);
      onChange();
      return note;
    },
  };
}

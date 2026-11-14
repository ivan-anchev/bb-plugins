// Composition root: the notes store and the rpc the Spotlight and the card call.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { NOTES_TAG, notesContract } from "./src/contract.ts";
import { createNotes } from "./src/server/notes.ts";
import { openStore } from "./src/server/store.ts";

export default function plugin(bb: BbPluginApi): void {
  const store = openStore(bb.storage);
  const notes = createNotes({ store, now: Date.now, onChange: () => bb.rpc.experimental_invalidate([NOTES_TAG]) });

  bb.rpc.register(notesContract, {
    notes: () => store.activeNotes(),
    createNote: (input) => notes.create(input),
    deleteNote: ({ id }) => {
      notes.remove(id);
      return {};
    },
  });
}

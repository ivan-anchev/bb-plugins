// Composition root: the notes store, the media files beside it, the rpc the Spotlight and the card
// call, and the route their <img> and <video> read.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { NOTES_TAG, notesContract } from "./src/contract.ts";
import { openMediaFiles } from "./src/server/media/media-files.ts";
import { mediaRoute } from "./src/server/media/media-route.ts";
import { createNotes } from "./src/server/notes.ts";
import { openStore } from "./src/server/store.ts";

export default function plugin(bb: BbPluginApi): void {
  const loadedAt = Date.now();
  const store = openStore(bb.storage);
  const media = openMediaFiles(bb.storage.database().name);
  bb.log.info(`Media files are in ${media.dir}`);
  const notes = createNotes({ store, media, now: Date.now, onChange: () => bb.rpc.experimental_invalidate([NOTES_TAG]) });

  const sweep = notes.sweep(loadedAt).then(
    (removed) => bb.log.info(`Media sweep removed ${removed.length} file(s) no note holds${removed.length === 0 ? "" : `: ${removed.join(", ")}`}`),
    (error: unknown) => bb.log.error(`Media sweep failed: ${String(error)}`),
  );
  // why: a reload must not leave this sweep deleting files and reading the database under the next load.
  bb.onDispose(() => sweep);

  bb.rpc.register(notesContract, {
    notes: () => store.activeNotes(),
    createNote: (input) => notes.create(input),
    deleteNote: async ({ id }) => {
      await notes.remove(id);
      return {};
    },
  });

  bb.http.route("GET", "/media", mediaRoute(store, media));
}

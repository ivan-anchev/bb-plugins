import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryStorage } from "./memory-storage.ts";
import { createNotes } from "./notes.ts";
import { openStore } from "./store.ts";

/** Notes over a fresh store, counting how often open cards are told to read again. */
function freshNotes() {
  const store = openStore(memoryStorage().storage);
  const changes = { count: 0 };
  const notes = createNotes({ store, now: () => 1_000, onChange: () => changes.count++ });
  return { notes, store, changes };
}

test("deleting a note removes it and tells open cards to read again", () => {
  const { notes, store, changes } = freshNotes();
  const kept = notes.create({ quote: null, body: { text: "kept", mentions: [] } });
  const deleted = notes.create({ quote: null, body: { text: "deleted", mentions: [] } });
  changes.count = 0;

  notes.remove(deleted.id);

  assert.deepEqual(store.activeNotes(), [kept]);
  assert.equal(changes.count, 1);
});

test("deleting the same note twice succeeds the second time", () => {
  const { notes, store } = freshNotes();
  const deleted = notes.create({ quote: null, body: { text: "deleted", mentions: [] } });
  notes.remove(deleted.id);

  assert.doesNotThrow(() => notes.remove(deleted.id));
  assert.deepEqual(store.activeNotes(), []);
});

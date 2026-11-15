import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { NewFile, NewNote } from "../contract.ts";
import { openMediaFiles } from "./media/media-files.ts";
import { memoryStorage } from "./memory-storage.ts";
import { createNotes } from "./notes.ts";
import { openStore } from "./store.ts";

/** Notes over a fresh store and a fresh media folder, counting how often open cards are told to read again. */
function freshNotes() {
  const store = openStore(memoryStorage().storage);
  const media = openMediaFiles(join(mkdtempSync(join(tmpdir(), "notes-test-")), "data.db"));
  const changes = { count: 0 };
  const notes = createNotes({ store, media, now: () => 1_000, onChange: () => changes.count++ });
  return { notes, store, media, changes };
}

function typed(text: string, files: NewFile[] = []): NewNote {
  return { quote: null, body: { text, mentions: [] }, files };
}

function file(name: string, mimeType: NewFile["mimeType"], bytes: string): NewFile {
  return { name, mimeType, base64: Buffer.from(bytes).toString("base64") };
}

const mediaNames = async (dir: string) => (await readdir(dir)).sort();

test("saving a note with files writes one file per attachment and lists them on the note", async () => {
  const { notes, store, media } = freshNotes();

  const saved = await notes.create(typed("", [file("shot.png", "image/png", "png bytes"), file("rec.mov", "video/quicktime", "mov")]));

  assert.deepEqual(
    saved.attachments.map(({ name, mimeType, sizeBytes }) => ({ name, mimeType, sizeBytes })),
    [
      { name: "shot.png", mimeType: "image/png", sizeBytes: 9 },
      { name: "rec.mov", mimeType: "video/quicktime", sizeBytes: 3 },
    ],
  );
  assert.deepEqual(store.activeNotes(), [saved]);
  assert.deepEqual(await mediaNames(media.dir), saved.attachments.map(({ id }) => id).sort());
  assert.equal(await readFile(join(media.dir, saved.attachments[0].id), "utf8"), "png bytes");
});

test("a file over 100 MB is refused, and the files already written for the note are removed", async () => {
  const { notes, store, media, changes } = freshNotes();
  const huge: NewFile = { name: "huge.mp4", mimeType: "video/mp4", base64: Buffer.alloc(100 * 1024 * 1024 + 1).toString("base64") };

  await assert.rejects(notes.create(typed("", [file("shot.png", "image/png", "png"), huge])), /huge\.mp4 is over 100 MB/);

  assert.deepEqual(store.activeNotes(), []);
  assert.deepEqual(await mediaNames(media.dir), []);
  assert.equal(changes.count, 0);
});

test("a note whose rows fail to insert leaves no files behind", async () => {
  const { store, media } = freshNotes();
  const failingStore: typeof store = {
    ...store,
    insert: () => {
      throw new Error("disk full");
    },
  };
  const failing = createNotes({ store: failingStore, media, now: () => 1_000, onChange: () => undefined });

  await assert.rejects(failing.create(typed("", [file("shot.png", "image/png", "png")])), /disk full/);

  assert.deepEqual(await mediaNames(media.dir), []);
});

test("deleting notes removes their rows and files at once, and tells open cards to read again once", async () => {
  const { notes, store, media, changes } = freshNotes();
  const kept = await notes.create(typed("kept", [file("kept.png", "image/png", "kept")]));
  const first = await notes.create(typed("first", [file("one.png", "image/png", "one"), file("two.mp4", "video/mp4", "two")]));
  const second = await notes.create(typed("second", [file("three.png", "image/png", "three")]));
  changes.count = 0;

  await notes.remove([first.id, second.id]);

  assert.deepEqual(store.activeNotes(), [kept]);
  assert.deepEqual(await mediaNames(media.dir), [kept.attachments[0].id]);
  assert.equal(changes.count, 1);
});

test("deleting notes one of which is already gone deletes the rest, and deleting them again succeeds", async () => {
  const { notes, store, media } = freshNotes();
  const gone = await notes.create(typed("gone"));
  const deleted = await notes.create(typed("deleted", [file("gone.png", "image/png", "gone")]));
  await notes.remove([gone.id]);

  await notes.remove([gone.id, deleted.id]);
  await assert.doesNotReject(notes.remove([gone.id, deleted.id]));

  assert.deepEqual(store.activeNotes(), []);
  assert.deepEqual(await mediaNames(media.dir), []);
});

test("the sweep removes files older than the load that no note holds, and keeps the rest", async () => {
  const { notes, media } = freshNotes();
  const held = await notes.create(typed("", [file("held.png", "image/png", "held")]));
  const loadedAt = Date.now();
  const longAgo = new Date(loadedAt - 60_000);
  await writeFile(join(media.dir, "stray.png"), "stray");
  await writeFile(join(media.dir, ".tmp-att_00000000-0000-4000-8000-000000000001"), "half");
  await Promise.all(
    [held.attachments[0].id, "stray.png", ".tmp-att_00000000-0000-4000-8000-000000000001"].map((name) => utimes(join(media.dir, name), longAgo, longAgo)),
  );
  await writeFile(join(media.dir, "att_00000000-0000-4000-8000-000000000002"), "being saved");
  // A file written just after the load, stamped a few ms earlier by the file system's coarse clock.
  const justAfter = new Date(loadedAt - 5);
  await utimes(join(media.dir, "att_00000000-0000-4000-8000-000000000002"), justAfter, justAfter);

  const removed = await notes.sweep(loadedAt);

  assert.deepEqual(removed.sort(), [".tmp-att_00000000-0000-4000-8000-000000000001", "stray.png"]);
  assert.deepEqual(await mediaNames(media.dir), [held.attachments[0].id, "att_00000000-0000-4000-8000-000000000002"].sort());
});

test("two sweeps over the same strays, as a reload overlaps the next load, both finish and remove them all", async () => {
  const { notes, media } = freshNotes();
  const held = await notes.create(typed("", [file("held.png", "image/png", "held")]));
  const loadedAt = Date.now();
  const longAgo = new Date(loadedAt - 60_000);
  const strays = Array.from({ length: 50 }, (_, n) => `stray-${n}.png`);
  await Promise.all(strays.map((name) => writeFile(join(media.dir, name), "stray")));
  await Promise.all(strays.map((name) => utimes(join(media.dir, name), longAgo, longAgo)));

  const [first, second] = await Promise.all([notes.sweep(loadedAt), notes.sweep(loadedAt)]);

  assert.deepEqual(new Set([...first, ...second]), new Set(strays));
  assert.deepEqual(await mediaNames(media.dir), [held.attachments[0].id]);
});

test("the sweep of a plugin that never stored media removes nothing", async () => {
  const { notes } = freshNotes();

  assert.deepEqual(await notes.sweep(Date.now()), []);
});

test("archiving notes takes them off the card, keeps their files, and tells open cards to read again", async () => {
  const { notes, store, media, changes } = freshNotes();
  const kept = await notes.create(typed("kept"));
  const used = await notes.create(typed("used", [file("used.png", "image/png", "used")]));
  changes.count = 0;

  notes.archive([used.id]);

  assert.deepEqual(store.activeNotes(), [kept]);
  assert.deepEqual(await mediaNames(media.dir), [used.attachments[0].id]);
  assert.equal(store.attachment(used.attachments[0].id)?.name, "used.png");
  assert.equal(changes.count, 1);
});

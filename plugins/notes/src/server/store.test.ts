import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentIdSchema, noteIdSchema, type Attachment, type Note } from "../contract.ts";
import { memoryStorage } from "./memory-storage.ts";
import { openStore } from "./store.ts";

/** A store over a fresh in-memory database, and that database for what the store can't do yet. */
function freshStore() {
  const { db, storage } = memoryStorage();
  return { db, store: openStore(storage) };
}

function note(n: number, text: string): Note {
  return { id: noteIdSchema.parse(`note_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`), createdAt: 1_000 * n, quote: null, body: { text, mentions: [] }, attachments: [] };
}

function attachment(n: number, mimeType: Attachment["mimeType"]): Attachment {
  return { id: attachmentIdSchema.parse(`att_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`), name: `file-${n}`, mimeType, sizeBytes: 1_000 * n };
}

test("a saved note reads back exactly as it was written", () => {
  const { store } = freshStore();
  const saved = note(1, "Check the chart before shipping");
  store.insert(saved);

  assert.deepEqual(store.activeNotes(), [saved]);
});

test("a note with a quote keeps it", () => {
  const { store } = freshStore();
  const quoted: Note = { ...note(1, ""), quote: { text: "Burn reports cents", threadId: "thr_abc", threadTitle: "Burn card", messageSeq: 41 } };
  store.insert(quoted);

  assert.deepEqual(store.activeNotes(), [quoted]);
});

test("a note's thread links read back with it", () => {
  const { store } = freshStore();
  const linked: Note = { ...note(1, "check @Burn weekly later"), body: { text: "check @Burn weekly later", mentions: [{ threadId: "thr_weekly", from: 6, to: 18 }] } };
  store.insert(linked);

  assert.deepEqual(store.activeNotes(), [linked]);
});

test("a stored link that does not cover an @ token is refused on read", () => {
  const { store } = freshStore();
  store.insert({ ...note(1, "check Burn weekly"), body: { text: "check Burn weekly", mentions: [{ threadId: "thr_weekly", from: 6, to: 17 }] } });

  assert.throws(() => store.activeNotes(), /A thread link must cover an @ token/);
});

test("stored links out of reading order are refused on read", () => {
  const { store } = freshStore();
  const text = "see @Spend and @Burn";
  store.insert({ ...note(1, text), body: { text, mentions: [{ threadId: "thr_burn", from: 15, to: 20 }, { threadId: "thr_spend", from: 4, to: 10 }] } });

  assert.throws(() => store.activeNotes(), /Thread links must be in order/);
});

test("notes list newest first", () => {
  const { store } = freshStore();
  store.insert(note(1, "first"));
  store.insert(note(3, "third"));
  store.insert(note(2, "second"));

  assert.deepEqual(
    store.activeNotes().map((n) => n.body.text),
    ["third", "second", "first"],
  );
});

test("archived notes are not listed", () => {
  const { db, store } = freshStore();
  store.insert(note(1, "kept"));
  store.insert(note(2, "archived"));
  db.prepare("UPDATE notes SET archived_at = ? WHERE id = ?").run(5_000, note(2, "").id);

  assert.deepEqual(
    store.activeNotes().map((n) => n.body.text),
    ["kept"],
  );
});

test("a deleted note is gone, and the others stay", () => {
  const { store } = freshStore();
  store.insert(note(1, "kept"));
  store.insert(note(2, "deleted"));

  store.delete(note(2, "").id);

  assert.deepEqual(
    store.activeNotes().map((n) => n.body.text),
    ["kept"],
  );
});

test("deleting a note that is already gone changes nothing", () => {
  const { store } = freshStore();
  store.insert(note(1, "kept"));
  store.delete(note(2, "").id);

  store.delete(note(2, "").id);

  assert.deepEqual(
    store.activeNotes().map((n) => n.body.text),
    ["kept"],
  );
});

test("a note's attachments read back with it, in the order they were attached", () => {
  const { store } = freshStore();
  const withFiles: Note = { ...note(1, ""), attachments: [attachment(2, "video/mp4"), attachment(1, "image/png"), attachment(3, "video/quicktime")] };
  store.insert(withFiles);
  store.insert(note(2, "no files"));

  assert.deepEqual(store.activeNotes(), [note(2, "no files"), withFiles]);
});

test("an attachment is found by its id until its note is deleted", () => {
  const { store } = freshStore();
  store.insert({ ...note(1, "with a file"), attachments: [attachment(1, "image/webp")] });

  assert.deepEqual(store.attachment(attachment(1, "image/webp").id), attachment(1, "image/webp"));
  assert.deepEqual(store.delete(note(1, "").id), [attachment(1, "image/webp").id]);
  assert.equal(store.attachment(attachment(1, "image/webp").id), null);
});

test("a note whose attachment rows fail to insert is not saved at all", () => {
  const { store } = freshStore();
  store.insert({ ...note(1, "first"), attachments: [attachment(1, "image/png")] });

  // why the same attachment id: its primary key refuses the second row, after the note's row went in.
  assert.throws(() => store.insert({ ...note(2, "second"), attachments: [attachment(1, "image/png")] }), /UNIQUE/);
  assert.deepEqual(
    store.activeNotes().map((n) => n.body.text),
    ["first"],
  );
});

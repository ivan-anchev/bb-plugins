import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentIdSchema, noteIdSchema, type Attachment, type Note } from "../contract.ts";
import { memoryStorage } from "./memory-storage.ts";
import { openStore } from "./store.ts";

/** A store over a fresh in-memory database, and that database for what the store never reads back. */
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

/** As Start thread left a note before decision 28: its row kept, off the list. */
function archiveAsBefore(db: ReturnType<typeof freshStore>["db"], id: Note["id"]): void {
  db.prepare("UPDATE notes SET archived_at = 5000 WHERE id = ?").run(id);
}

test("notes an earlier version archived are not listed", () => {
  const { db, store } = freshStore();
  store.insert(note(1, "kept"));
  store.insert(note(2, "archived"));
  archiveAsBefore(db, note(2, "").id);

  assert.deepEqual(
    store.activeNotes().map((n) => n.body.text),
    ["kept"],
  );
});

test("notes asked for by id come oldest first, with their attachments, leaving out archived and unknown ids", () => {
  const { db, store } = freshStore();
  const withFile: Note = { ...note(1, "first"), attachments: [attachment(1, "image/png")] };
  store.insert(note(3, "third"));
  store.insert(withFile);
  store.insert(note(2, "archived"));
  archiveAsBefore(db, note(2, "").id);

  assert.deepEqual(store.activeNotesByIds([note(3, "").id, note(2, "").id, note(1, "").id, note(9, "").id]), [withFile, note(3, "third")]);
});

test("deleted notes are gone, and the others stay", () => {
  const { store } = freshStore();
  store.insert(note(1, "kept"));
  store.insert(note(2, "deleted"));
  store.insert(note(3, "also deleted"));

  store.delete([note(2, "").id, note(3, "").id]);

  assert.deepEqual(
    store.activeNotes().map((n) => n.body.text),
    ["kept"],
  );
});

test("deleting a note that is already gone changes nothing", () => {
  const { store } = freshStore();
  store.insert(note(1, "kept"));
  store.delete([note(2, "").id]);

  store.delete([note(2, "").id]);

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
  assert.deepEqual(store.delete([note(1, "").id]), [attachment(1, "image/webp").id]);
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

test("notes put in a draft read back grouped by draft and brief", () => {
  const { store } = freshStore();
  [1, 2, 3].forEach((n) => store.insert(note(n, `note ${n}`)));

  store.putInDraft({ composerKey: "draft-3", brief: "Context from 2 notes:", noteIds: [note(1, "").id, note(2, "").id] });
  store.putInDraft({ composerKey: "thread-x", brief: "Context from 1 note:", noteIds: [note(3, "").id] });

  assert.deepEqual(store.inDrafts(), [
    { composerKey: "draft-3", brief: "Context from 2 notes:", noteIds: [note(1, "").id, note(2, "").id] },
    { composerKey: "thread-x", brief: "Context from 1 note:", noteIds: [note(3, "").id] },
  ]);
});

test("a note put in a second draft waits only there", () => {
  const { store } = freshStore();
  [1, 2].forEach((n) => store.insert(note(n, `note ${n}`)));
  store.putInDraft({ composerKey: "draft-3", brief: "first brief", noteIds: [note(1, "").id, note(2, "").id] });

  store.putInDraft({ composerKey: "thread-x", brief: "second brief", noteIds: [note(2, "").id] });

  assert.deepEqual(store.inDrafts(), [
    { composerKey: "draft-3", brief: "first brief", noteIds: [note(1, "").id] },
    { composerKey: "thread-x", brief: "second brief", noteIds: [note(2, "").id] },
  ]);
});

test("only notes on the list can wait in a draft", () => {
  const { db, store } = freshStore();
  store.insert(note(1, "listed"));
  store.insert(note(2, "archived"));
  archiveAsBefore(db, note(2, "").id);

  store.putInDraft({ composerKey: "draft-3", brief: "brief", noteIds: [note(1, "").id, note(2, "").id, note(9, "").id] });

  assert.deepEqual(store.inDrafts(), [{ composerKey: "draft-3", brief: "brief", noteIds: [note(1, "").id] }]);
});

test("leaving a draft clears only that draft's marks for that brief", () => {
  const { store } = freshStore();
  [1, 2, 3].forEach((n) => store.insert(note(n, `note ${n}`)));
  store.putInDraft({ composerKey: "draft-3", brief: "brief", noteIds: [note(1, "").id] });
  store.putInDraft({ composerKey: "draft-3", brief: "newer brief", noteIds: [note(3, "").id] });
  store.putInDraft({ composerKey: "thread-x", brief: "brief", noteIds: [note(2, "").id] });

  store.leaveDraft({ composerKey: "draft-3", brief: "brief" });

  assert.deepEqual(store.inDrafts(), [
    { composerKey: "draft-3", brief: "newer brief", noteIds: [note(3, "").id] },
    { composerKey: "thread-x", brief: "brief", noteIds: [note(2, "").id] },
  ]);
});

test("a deleted note no longer waits in a draft", () => {
  const { store } = freshStore();
  [1, 2].forEach((n) => store.insert(note(n, `note ${n}`)));
  store.putInDraft({ composerKey: "draft-3", brief: "brief", noteIds: [note(1, "").id, note(2, "").id] });

  store.delete([note(1, "").id]);

  assert.deepEqual(store.inDrafts(), [{ composerKey: "draft-3", brief: "brief", noteIds: [note(2, "").id] }]);
});

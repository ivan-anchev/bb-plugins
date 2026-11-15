import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { memoryStorage } from "../memory-storage.ts";
import { openMediaFiles } from "../media/media-files.ts";
import { createNotes } from "../notes.ts";
import { openStore } from "../store.ts";
import { uploadForBrief } from "./upload.ts";

const refuseUploads = { upload: () => Promise.reject(new Error("a file too large for bb is never uploaded")) };

test("a file too large to attach is named by a path that outlives its note, its send and the sweep", async () => {
  const store = openStore(memoryStorage().storage);
  const media = openMediaFiles(join(mkdtempSync(join(tmpdir(), "notes-test-")), "data.db"));
  const notes = createNotes({ store, media, now: () => 1_000, onChange: () => undefined });
  const note = await notes.create({ quote: null, body: { text: "", mentions: [] }, files: [{ name: "rec.mov", mimeType: "video/quicktime", base64: Buffer.from("mov").toString("base64") }] });
  // why the size is claimed, not written: the path is chosen by the size the note records.
  const large = { ...note.attachments[0], sizeBytes: 40 * 1024 * 1024 };

  const first = await uploadForBrief(refuseUploads, media, "proj_personal", large);
  const again = await uploadForBrief(refuseUploads, media, "proj_personal", large);
  assert.ok(first.kind === "tooLarge");
  assert.deepEqual(again, first);
  assert.notEqual(first.path, media.path(large.id));

  notes.putInDraft({ composerKey: "draft-3", brief: "brief", noteIds: [note.id] });
  await notes.sent("draft-3", "brief");
  await notes.sweep(Date.now() + 60_000);

  assert.deepEqual(store.activeNotes(), []);
  await assert.rejects(readFile(media.path(large.id)));
  assert.equal(await readFile(first.path, "utf8"), "mov");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentIdSchema, noteIdSchema, type Attachment, type Note, type NoteBody, type Quote } from "../../../contract.ts";
import { noteLine, sourceTitle } from "./card-text.ts";

const QUOTE: Quote = { text: "Burn reports spend\nin cents.", threadId: "thr_abc", threadTitle: "Burn card", messageSeq: 41 };

function note(text: string, quote: Quote | null, mentions: NoteBody["mentions"] = [], attachments: Attachment[] = []): Note {
  return { id: noteIdSchema.parse("note_00000000-0000-4000-8000-000000000001"), createdAt: 1_000, quote, body: { text, mentions }, attachments };
}

function attached(n: number, mimeType: Attachment["mimeType"]): Attachment {
  return { id: attachmentIdSchema.parse(`att_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`), name: `file-${n}`, mimeType, sizeBytes: 1_000 };
}

const LINKED_TEXT = "check @Burn weekly later, see @Spend";
const LINKS: NoteBody["mentions"] = [
  { threadId: "thr_weekly", from: 6, to: 18 },
  { threadId: "thr_spend", from: 30, to: 36 },
];

test("a typed note shows its own words on one line, and no source", () => {
  const typed = note("Check the chart\n\nbefore shipping", null);

  assert.equal(noteLine(typed), "Check the chart before shipping");
  assert.equal(sourceTitle(typed), null);
});

test("a quote saved with no words shows the quote in quotation marks, and its thread's title", () => {
  const quoted = note("", QUOTE);

  assert.equal(noteLine(quoted), "“Burn reports spend in cents.”");
  assert.equal(sourceTitle(quoted), "Burn card");
});

test("a quote saved with words shows the words", () => {
  assert.equal(noteLine(note("Undercounts new providers", QUOTE)), "Undercounts new providers");
});

test("a note with no quote names the first thread it links on line 2", () => {
  assert.equal(sourceTitle(note(LINKED_TEXT, null, LINKS)), "Burn weekly");
});

test("a note with a quote names the quote's thread, even when it links another", () => {
  assert.equal(sourceTitle(note(LINKED_TEXT, QUOTE, LINKS)), "Burn card");
});

test("a note of files alone counts them on line 1: screenshots, recordings, or attachments when mixed", () => {
  const filesOnly = (...attachments: Attachment[]) => noteLine(note("", null, [], attachments));

  assert.equal(filesOnly(attached(1, "image/png"), attached(2, "image/jpeg")), "2 screenshots");
  assert.equal(filesOnly(attached(1, "video/quicktime")), "1 recording");
  assert.equal(filesOnly(attached(1, "image/png"), attached(2, "video/mp4"), attached(3, "image/gif")), "3 attachments");
});

test("a note's words or quote come before its files on line 1", () => {
  const files = [attached(1, "image/png")];

  assert.equal(noteLine(note("Look at the chart", null, [], files)), "Look at the chart");
  assert.equal(noteLine(note("", QUOTE, [], files)), "“Burn reports spend in cents.”");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { noteIdSchema, type Note, type NoteBody, type Quote } from "../../../contract.ts";
import { noteLine, sourceTitle } from "./card-text.ts";

const QUOTE: Quote = { text: "Burn reports spend\nin cents.", threadId: "thr_abc", threadTitle: "Burn card", messageSeq: 41 };

function note(text: string, quote: Quote | null, mentions: NoteBody["mentions"] = []): Note {
  return { id: noteIdSchema.parse("note_00000000-0000-4000-8000-000000000001"), createdAt: 1_000, quote, body: { text, mentions } };
}

/** Links the thread "Burn weekly", then "Spend". */
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

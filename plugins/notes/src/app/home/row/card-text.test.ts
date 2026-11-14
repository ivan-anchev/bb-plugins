import assert from "node:assert/strict";
import { test } from "node:test";
import { noteIdSchema, type Note, type Quote } from "../../../contract.ts";
import { noteLine, sourceTitle } from "./card-text.ts";

const QUOTE: Quote = { text: "Burn reports spend\nin cents.", threadId: "thr_abc", threadTitle: "Burn card", messageSeq: 41 };

function note(text: string, quote: Quote | null): Note {
  return { id: noteIdSchema.parse("note_00000000-0000-4000-8000-000000000001"), createdAt: 1_000, quote, body: { text, mentions: [] } };
}

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

import assert from "node:assert/strict";
import { test } from "node:test";
import { noteIdSchema, type InDraft } from "../../contract.ts";
import { judgeDraft, type SeenBriefs } from "./seen-briefs.ts";

const waiting: InDraft = { composerKey: "draft-3", brief: "Context from 1 note:\n\nused", noteIds: [noteIdSchema.parse("note_00000000-0000-4000-8000-000000000001")] };

/** Judges each draft in turn, as a window watching one composer would, and returns every brief seen gone. */
function watch(steps: readonly { text: string; waiting: readonly InDraft[] }[]): InDraft[] {
  let seen: SeenBriefs = new Set();
  return steps.flatMap(({ text, waiting }) => {
    const next = judgeDraft(seen, text, waiting);
    seen = next.seen;
    return next.gone;
  });
}

test("a brief seen in the draft, then taken out, is gone once", () => {
  const filled = `Hi\n\n${waiting.brief}`;
  assert.deepEqual(watch([{ text: filled, waiting: [waiting] }, { text: "Hi", waiting: [waiting] }, { text: "Hi!", waiting: [waiting] }]), [waiting]);
});

test("a draft that never held the brief here clears nothing: another window's draft for the same composer", () => {
  assert.deepEqual(watch([{ text: "", waiting: [waiting] }, { text: "something else", waiting: [waiting] }]), []);
});

test("a mark that arrives before its fill is seen once the fill lands, whatever came first", () => {
  assert.deepEqual(watch([{ text: "", waiting: [waiting] }, { text: waiting.brief, waiting: [waiting] }, { text: "", waiting: [waiting] }]), [waiting]);
  assert.deepEqual(watch([{ text: waiting.brief, waiting: [] }, { text: waiting.brief, waiting: [waiting] }, { text: "", waiting: [waiting] }]), [waiting]);
});

test("a brief no longer waiting, as after its send, is forgotten rather than gone", () => {
  assert.deepEqual(watch([{ text: waiting.brief, waiting: [waiting] }, { text: "", waiting: [] }, { text: "", waiting: [waiting] }]), []);
});

test("editing any of the brief's text counts as taking it out", () => {
  assert.deepEqual(watch([{ text: waiting.brief, waiting: [waiting] }, { text: waiting.brief.replace("used", "use"), waiting: [waiting] }]), [waiting]);
});

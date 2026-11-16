import assert from "node:assert/strict";
import { test } from "node:test";
import type { MemoryRevision, MemorySnapshot, MemoryText, WriteOutcome } from "../../model/memory-file.ts";
import { draftAfter, editorState, fileNow, isSaved, NO_SAVE, saveOf, settled, typed, type Draft, type FileEdit, type Save } from "./draft.ts";

const v1 = { content: "# Plan\n\nNo plan yet.\n", version: "v1" };
const v2 = { content: "# Plan\n\n1. Inventory the endpoints\n", version: "v2" };
const v3 = { content: "# Plan\n\n1. Inventory the endpoints\n2. Map the zones\n", version: "v3" };

/** The file as the server saw it at `revision`. */
const at = (text: MemoryText | null, revision: MemoryRevision): MemorySnapshot => ({ text, revision });

/** A file's edit with no save out: the draft alone. */
const drafted = (draft: Draft | null): FileEdit => ({ ...NO_SAVE, draft });

/** The edit once the save is answered: its save settled, and its draft as the answer leaves it. */
const answered = (edit: FileEdit, save: Save, outcome: WriteOutcome): FileEdit => ({ ...settled(save, outcome), draft: draftAfter(edit.draft, save, outcome) });

/** The user typed `text` over `read`, and pressed Save: the edit while it is out, and the save. */
function sent(read: MemorySnapshot, text: string): { edit: FileEdit; save: Save } {
  const edit = drafted(typed(text, read.text, null));
  const save = saveOf(read, edit);
  assert.ok(save !== null);
  return { edit: { ...edit, saving: true }, save };
}

test("with no draft the editor shows the file as read now, and follows each newer read", () => {
  assert.deepEqual(editorState(v1, null), { kind: "clean", text: v1.content });
  assert.deepEqual(editorState(v2, null), { kind: "clean", text: v2.content });
  assert.deepEqual(editorState(null, null), { kind: "clean", text: "" });
});

test("typing starts a draft from the version read, and typing back to the file's text drops it", () => {
  const draft = typed("# Plan\n\nMine\n", v1, null);
  assert.deepEqual(draft, { text: "# Plan\n\nMine\n", base: "v1" });
  assert.deepEqual(typed("# Plan\n\nMine, more\n", v1, draft), { text: "# Plan\n\nMine, more\n", base: "v1" });
  assert.equal(typed(v1.content, v1, draft), null);
  assert.deepEqual(editorState(v1, draft), { kind: "edited", draft });
  assert.equal(saveOf(at(v1, 1), drafted(draft))?.base, "v1");
});

test("a draft on a file that doesn't exist yet creates it", () => {
  const draft = typed("# API\n", null, null);
  assert.deepEqual(draft, { text: "# API\n", base: null });
  assert.equal(editorState(null, draft).kind, "edited");
  assert.equal(saveOf(at(null, 1), drafted(draft))?.base, null);
});

test("when the file moves on under a draft, the draft is kept beside the newer version, and saving names the version shown", () => {
  const draft = typed("# Plan\n\nMine\n", v1, null);

  assert.deepEqual(editorState(v2, draft), { kind: "conflict", draft, newer: v2 });
  assert.equal(saveOf(at(v2, 2), drafted(draft))?.base, "v2");
  assert.deepEqual(editorState(null, draft), { kind: "conflict", draft, newer: null });
});

test("typing in a conflict keeps the draft's base, so the conflict stays until the user saves or takes the newer version", () => {
  const draft = typed("# Plan\n\nMine\n", v1, null);
  assert.deepEqual(typed("# Plan\n\nMine, merged\n", v2, draft), { text: "# Plan\n\nMine, merged\n", base: "v1" });
  assert.equal(typed(v2.content, v2, draft), null);
});

test("a draft on a file that didn't exist stays in conflict once another writer creates it, however much the user types", () => {
  const draft = typed("# API\n\nMine\n", null, null);
  const next = typed("# API\n\nMine, more\n", v1, draft);
  assert.deepEqual(next, { text: "# API\n\nMine, more\n", base: null });
  assert.equal(editorState(v1, next).kind, "conflict");
});

test("while a save is out there is nothing more to send", () => {
  const { edit } = sent(at(v1, 1), "# Plan\n\nMine\n");
  assert.equal(saveOf(at(v1, 1), edit), null);
});

test("a saved draft shows as saved even when every refresh after it fails", () => {
  const { edit, save } = sent(at(v1, 1), "# Plan\n\nMine\n");
  const after = answered(edit, save, { outcome: "saved", version: "v9", revision: 2 });

  // The read is still revision 1: its refresh failed.
  const file = fileNow(at(v1, 1), after);
  assert.deepEqual(editorState(file.text, after.draft), { kind: "clean", text: "# Plan\n\nMine\n" });
  assert.ok(isSaved(file, after));
  // Typing on goes on from the version saved.
  assert.equal(saveOf(at(v1, 1), { ...after, draft: typed("# Plan\n\nMine, more\n", file.text, after.draft) })?.base, "v9");
  // The refresh that comes through shows the same revision, still saved.
  assert.ok(isSaved(fileNow(at({ content: "# Plan\n\nMine\n", version: "v9" }, 2), after), after));
});

test("a save's answer cannot drop a draft the user typed after it", () => {
  const { edit, save } = sent(at(v1, 1), "# Plan\n\nMine\n");
  const newer = { text: "# Plan\n\nMine, typed after\n", base: "v1" };

  const after = answered({ ...edit, draft: newer }, save, { outcome: "saved", version: "v9", revision: 2 });
  assert.deepEqual(after.draft, newer);
  assert.equal(after.saving, false);
});

test("a refused save shows the file as the write found it, with no further read", () => {
  const { edit, save } = sent(at(v1, 1), "# Plan\n\nMine\n");
  const after = answered(edit, save, { outcome: "conflict", current: at(v2, 2) });

  assert.deepEqual(editorState(fileNow(at(v1, 1), after).text, after.draft), { kind: "conflict", draft: edit.draft, newer: v2 });
  assert.equal(saveOf(at(v1, 1), after)?.base, "v2");
  assert.ok(!isSaved(fileNow(at(v1, 1), after), after));
});

test("a refused save on a deleted file shows it deleted, and saving creates it again", () => {
  const { edit, save } = sent(at(v1, 1), "# Plan\n\nMine\n");
  const after = answered(edit, save, { outcome: "conflict", current: at(null, 2) });

  assert.deepEqual(editorState(fileNow(at(v1, 1), after).text, after.draft), { kind: "conflict", draft: edit.draft, newer: null });
  assert.equal(saveOf(at(v1, 1), after)?.base, null);
});

test("a read that moves on while a save is out doesn't hide the later file the refusal returns, whichever arrives last", () => {
  // Read A, save; the read refreshes to B during the save; the write then finds C and is refused.
  const { edit, save } = sent(at(v1, 1), "# Plan\n\nMine\n");
  const after = answered(edit, save, { outcome: "conflict", current: at(v3, 3) });

  for (const read of [at(v2, 2), at(v1, 1)]) {
    assert.deepEqual(fileNow(read, after), at(v3, 3));
    assert.deepEqual(editorState(fileNow(read, after).text, after.draft), { kind: "conflict", draft: edit.draft, newer: v3 });
    assert.equal(saveOf(read, after)?.base, "v3", "saving replaces only the version shown");
  }
});

test("a later read wins over a save's answer, even when it goes back to the text from before the save", () => {
  const { edit, save } = sent(at(v1, 1), "# Plan\n\nMine\n");
  const saved = answered(edit, save, { outcome: "saved", version: "v9", revision: 2 });

  // Someone put A's text back after the save: the server saw it at revision 3.
  assert.deepEqual(fileNow(at(v1, 3), saved), at(v1, 3));
  assert.deepEqual(editorState(fileNow(at(v1, 3), saved).text, saved.draft), { kind: "clean", text: v1.content });
  assert.ok(!isSaved(fileNow(at(v1, 3), saved), saved));

  // A refused save is not brought back either: with the file back at the draft's base, the draft is
  // an edit of it again, and saves over it.
  const refused = answered(edit, save, { outcome: "conflict", current: at(v2, 2) });
  assert.deepEqual(editorState(fileNow(at(v1, 3), refused).text, refused.draft), { kind: "edited", draft: edit.draft });
  assert.equal(saveOf(at(v1, 3), refused)?.base, "v1");
});

test("once the read moves past a save's answer, the read wins again", () => {
  const { edit, save } = sent(at(v1, 1), "# Plan\n\nMine\n");
  const after = answered(edit, save, { outcome: "saved", version: "v9", revision: 2 });

  assert.deepEqual(fileNow(at(v3, 3), after), at(v3, 3));
  assert.deepEqual(editorState(fileNow(at(v3, 3), after).text, after.draft), { kind: "clean", text: v3.content });
  assert.ok(!isSaved(at(v3, 3), after));
});

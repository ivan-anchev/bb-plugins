import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CRITERIA, MAX_CRITERION_CHARS } from "../../../model/crew.ts";
import { added, criteriaOf, fieldsOf, joined, removed, split, type CriterionField } from "./criteria.ts";

const texts = (fields: readonly CriterionField[]) => fields.map((field) => field.text);
const LIST = fieldsOf(["npm test passes", "a failed delivery is retried 3 times"]);

test("Enter at a criterion's end starts an empty one after it, and focus goes there", () => {
  const edit = split(LIST, 0, 15, 15);
  assert.ok(edit !== null);
  assert.deepEqual(texts(edit.fields), ["npm test passes", "", "a failed delivery is retried 3 times"]);
  assert.deepEqual(edit.focus, { key: edit.fields[1]?.key, caret: 0 });
  assert.equal(new Set(edit.fields.map((field) => field.key)).size, 3, "the new field has a key of its own");
});

test("Enter mid-criterion moves the text after the caret, or after the selection, to the next one", () => {
  assert.deepEqual(texts(split(LIST, 0, 9, 9)?.fields ?? []), ["npm test ", "passes", "a failed delivery is retried 3 times"]);
  assert.deepEqual(texts(split(LIST, 0, 3, 9)?.fields ?? []), ["npm", "passes", "a failed delivery is retried 3 times"]);
});

test("Enter in a full list adds nothing", () => {
  const full = fieldsOf(Array.from({ length: MAX_CRITERIA }, (_, i) => `criterion ${i + 1}`));
  assert.equal(split(full, 3, 0, 0), null);
});

test("Backspace at a criterion's start joins it to the one above, undoing Enter, with the caret where they meet", () => {
  const edit = split(LIST, 0, 9, 9);
  assert.ok(edit !== null);
  const undone = joined(edit.fields, 1);
  assert.ok(undone !== null);
  assert.deepEqual(texts(undone.fields), texts(LIST));
  assert.deepEqual(undone.focus, { key: LIST[0]?.key, caret: 9 });
});

test("Backspace on an empty criterion removes it, and focus goes to the end of the one above", () => {
  const edit = added(LIST);
  const undone = joined(edit.fields, 2);
  assert.ok(undone !== null);
  assert.deepEqual(texts(undone.fields), texts(LIST));
  assert.deepEqual(undone.focus, { key: LIST[1]?.key, caret: LIST[1]?.text.length });
});

test("Backspace at the start of the first criterion, or one too long to join, does nothing", () => {
  assert.equal(joined(LIST, 0), null);
  const long = fieldsOf(["a".repeat(MAX_CRITERION_CHARS - 2), "abc"]);
  assert.equal(joined(long, 1), null);
});

test("Add puts an empty criterion at the end and focuses it", () => {
  const edit = added(LIST);
  assert.deepEqual(texts(edit.fields), [...texts(LIST), ""]);
  assert.deepEqual(edit.focus, { key: edit.fields[2]?.key, caret: 0 });
});

test("removing a criterion focuses the end of the one above it, or of the new first", () => {
  const three = fieldsOf(["one", "two", "three"]);
  assert.deepEqual(removed(three, 2).focus, { key: three[1]?.key, caret: 3 });
  assert.deepEqual(texts(removed(three, 0).fields), ["two", "three"]);
  assert.deepEqual(removed(three, 0).focus, { key: three[1]?.key, caret: 3 });
});

test("a save sends the criteria trimmed, without the empty ones", () => {
  assert.deepEqual(criteriaOf(fieldsOf(["  npm test passes ", "", "   ", "line one\nline two"])), ["npm test passes", "line one\nline two"]);
});

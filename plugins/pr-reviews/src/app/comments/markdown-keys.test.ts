import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownShortcut } from "./markdown-keys.ts";

const TEXT = "keep 200 until paging lands";
const SELECTED = { text: TEXT, start: 5, end: 8 }; // "200"

test("⌘B, ⌘I, ⌘E and ⌘K wrap the selected text, which stays selected", () => {
  assert.deepEqual(markdownShortcut("b", SELECTED), { text: "keep **200** until paging lands", start: 7, end: 10 });
  assert.deepEqual(markdownShortcut("i", SELECTED), { text: "keep _200_ until paging lands", start: 6, end: 9 });
  assert.deepEqual(markdownShortcut("e", SELECTED), { text: "keep `200` until paging lands", start: 6, end: 9 });
  assert.deepEqual(markdownShortcut("k", SELECTED), { text: "keep [200](https://) until paging lands", start: 6, end: 9 });
});

test("with nothing selected, a placeholder is wrapped at the caret and selected to type over", () => {
  assert.deepEqual(markdownShortcut("b", { text: "a  b", start: 2, end: 2 }), { text: "a **bold** b", start: 4, end: 8 });
  assert.deepEqual(markdownShortcut("k", { text: "", start: 0, end: 0 }), { text: "[text](https://)", start: 1, end: 5 });
});

test("Shift and caps lock don't matter, and other keys are no shortcut", () => {
  assert.deepEqual(markdownShortcut("B", SELECTED), markdownShortcut("b", SELECTED));
  assert.equal(markdownShortcut("u", SELECTED), null);
  assert.equal(markdownShortcut("Enter", SELECTED), null);
});

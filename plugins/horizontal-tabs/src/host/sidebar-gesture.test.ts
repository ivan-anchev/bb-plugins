import assert from "node:assert/strict";
import { test } from "node:test";
import { gestureOf } from "./sidebar-gesture.ts";

const plain = { type: "click", button: 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const middle = { ...plain, type: "auxclick", button: 1 };

test("a plain click goes to the tab showing the thread, and a middle-click opens a new tab", () => {
  assert.equal(gestureOf(plain), "plain");
  assert.equal(gestureOf(middle), "newTab");
});

test("Cmd/Ctrl-click stays bb's open-in-split, on every platform", () => {
  assert.equal(gestureOf({ ...plain, ctrlKey: true }), null);
  assert.equal(gestureOf({ ...plain, metaKey: true }), null);
});

test("Shift- and Alt-clicks, modified middle-clicks and other buttons stay bb's", () => {
  for (const click of [
    { ...plain, shiftKey: true },
    { ...plain, altKey: true },
    { ...middle, ctrlKey: true },
    { ...middle, metaKey: true },
    { ...middle, shiftKey: true },
    { ...plain, type: "auxclick", button: 2 },
  ]) {
    assert.equal(gestureOf(click), null, JSON.stringify(click));
  }
});

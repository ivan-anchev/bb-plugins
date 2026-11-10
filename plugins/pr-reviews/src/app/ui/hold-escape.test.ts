import assert from "node:assert/strict";
import { test } from "node:test";
import { holdEscape } from "./hold-escape.ts";

// A key pressed on the page; `defaultPrevented` after dispatch is what bb's own Esc checks.
function press(page: EventTarget, key: string): boolean {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key });
  page.dispatchEvent(event);
  return event.defaultPrevented;
}

test("while a box is open, an Esc anywhere on the page never reaches bb", () => {
  const page = new EventTarget();
  holdEscape(page);

  assert.equal(press(page, "Escape"), true);
});

test("other keys are left alone", () => {
  const page = new EventTarget();
  holdEscape(page);

  assert.equal(press(page, "Enter"), false);
  assert.equal(press(page, "a"), false);
});

test("once the box has closed, Esc is bb's again and goes home", () => {
  const page = new EventTarget();
  const release = holdEscape(page);
  release();

  assert.equal(press(page, "Escape"), false);
});

test("with two boxes open, closing one keeps the page held until the other closes", () => {
  const page = new EventTarget();
  const releaseFirst = holdEscape(page);
  const releaseSecond = holdEscape(page);

  releaseFirst();
  assert.equal(press(page, "Escape"), true);

  releaseSecond();
  assert.equal(press(page, "Escape"), false);
});

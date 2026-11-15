import assert from "node:assert/strict";
import { test } from "node:test";
import { holdEscape } from "./hold-escape.ts";

function keydown(key: string): Event {
  return Object.assign(new Event("keydown", { cancelable: true }), { key });
}

test("an Esc nothing on the page took is kept from bb and handed over", () => {
  const target = new EventTarget();
  let handed = 0;
  holdEscape(target, () => handed++);
  const esc = keydown("Escape");
  target.dispatchEvent(esc);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(handed, 1);
});

test("an Esc a dialog already took is not handed over", () => {
  const target = new EventTarget();
  let handed = 0;
  target.addEventListener("keydown", (event) => event.preventDefault());
  holdEscape(target, () => handed++);
  target.dispatchEvent(keydown("Escape"));
  assert.equal(handed, 0);
});

test("other keys pass through, and nothing is held once released", () => {
  const target = new EventTarget();
  let handed = 0;
  const release = holdEscape(target, () => handed++);
  const enter = keydown("Enter");
  target.dispatchEvent(enter);
  release();
  const esc = keydown("Escape");
  target.dispatchEvent(esc);
  assert.deepEqual([enter.defaultPrevented, esc.defaultPrevented, handed], [false, false, 0]);
});

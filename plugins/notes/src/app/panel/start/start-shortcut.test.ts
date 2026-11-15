import assert from "node:assert/strict";
import { test } from "node:test";
import { startShortcut } from "./start-shortcut.ts";

const press = (key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  startShortcut({ key, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt });

test("⌘↵, or Ctrl+Enter off macOS, asks for New thread", () => {
  assert.equal(press("Enter", { meta: true }), "new-thread");
  assert.equal(press("Enter", { ctrl: true }), "new-thread");
});

test("⇧⌘↵ and ⌥⌘↵ both ask for Send to this thread", () => {
  assert.equal(press("Enter", { meta: true, shift: true }), "this-thread");
  assert.equal(press("Enter", { meta: true, alt: true }), "this-thread");
  assert.equal(press("Enter", { ctrl: true, shift: true }), "this-thread");
});

test("Enter without ⌘, or ⌘ with another key, asks for nothing", () => {
  assert.equal(press("Enter"), null);
  assert.equal(press("Enter", { shift: true }), null);
  assert.equal(press("j", { meta: true, shift: true }), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { notesPopover, usePopoverState, type Capture } from "./popover-store.ts";

function render(): ReturnType<typeof usePopoverState> {
  let seen: ReturnType<typeof usePopoverState> | undefined;
  renderToStaticMarkup(createElement(() => ((seen = usePopoverState()), null)));
  assert.ok(seen);
  return seen;
}

const passage = (text: string): Capture => ({ text, threadId: "thr_abc", messageSeq: 3 });

test("the footer button opens on the popover and closes again", () => {
  notesPopover.toggleFromButton();
  const opened = render();
  assert.ok(opened.open);
  assert.deepEqual([opened.focus, opened.openedBy, opened.quote], ["panel", "button", null]);
  notesPopover.toggleFromButton();
  assert.deepEqual(render(), { open: false });
});

test("⇧⌘J opens on the form, and moves focus there again while open", () => {
  notesPopover.write();
  const opened = render();
  assert.ok(opened.open && opened.focus === "form" && opened.openedBy === "focus");

  notesPopover.write();
  const refocused = render();
  assert.ok(refocused.open && refocused.focusRequest > opened.focusRequest && refocused.opening === opened.opening);
  notesPopover.close();
  assert.deepEqual(render(), { open: false });
});

test("a capture while open replaces the quote and keeps who opened it", () => {
  notesPopover.toggleFromButton();
  notesPopover.capture(passage("first"));
  notesPopover.capture(passage("second"));
  const state = render();
  assert.ok(state.open);
  assert.deepEqual([state.quote?.text, state.focus, state.openedBy], ["second", "form", "button"]);

  notesPopover.capture(null);
  const kept = render();
  assert.ok(kept.open && kept.quote?.text === "second");
  notesPopover.close();
});

test("a save clears only the quote it used", () => {
  const saved = passage("saved");
  notesPopover.capture(saved);
  const next = passage("captured while saving");
  notesPopover.capture(next);

  notesPopover.clearQuote(saved);

  const state = render();
  assert.ok(state.open && state.quote === next);
  notesPopover.clearQuote(next);
  const cleared = render();
  assert.ok(cleared.open && cleared.quote === null);
  notesPopover.close();
});

test("an opening stops showing once closed, and a later opening is not it", () => {
  notesPopover.toggleFromButton();
  const first = render();
  assert.ok(first.open && notesPopover.isShowing(first.opening));

  notesPopover.write();
  assert.ok(notesPopover.isShowing(first.opening));

  notesPopover.close();
  assert.equal(notesPopover.isShowing(first.opening), false);

  notesPopover.write();
  const second = render();
  assert.ok(second.open && notesPopover.isShowing(second.opening));
  assert.equal(notesPopover.isShowing(first.opening), false);
  notesPopover.close();
});

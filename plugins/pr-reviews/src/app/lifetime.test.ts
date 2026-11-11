import assert from "node:assert/strict";
import { test } from "node:test";
import type { SelectedLineRange } from "@pierre/diffs";
import { linesPicked, NO_LINES, settled, type DiffLines } from "./diff/line-selection.ts";
import { lifetime, type Lifetime } from "./lifetime.ts";

const LINES_5_7: SelectedLineRange = { start: 5, end: 7, side: "additions" };
const LINES_20_22: SelectedLineRange = { start: 20, end: 22, side: "additions" };

test("a completion runs while its owner is on screen, and does nothing once the owner has gone", () => {
  const life = lifetime();
  const calls: string[] = [];
  const done = life.bind((what: string) => calls.push(what));

  life.begin();
  done("while here");
  life.end();
  done("after leaving");

  assert.deepEqual(calls, ["while here"]);
});

test("mounted again, as StrictMode does, the owner is live again", () => {
  const life = lifetime();
  const calls: string[] = [];
  const done = life.bind(() => calls.push("ran"));

  life.begin();
  life.end();
  life.begin();
  done();

  assert.deepEqual(calls, ["ran"]);
});

// The comment box, as pr-diff.tsx and comment-box.tsx wire it: the box is drawn afresh, with its
// own lifetime, each time it opens, and a send's reply settles the box through that lifetime.
test("a reply to a box that has since moved to other lines leaves the moved box and its draft alone", async () => {
  let lines: DiffLines = NO_LINES;
  const openBox = () => {
    const life = lifetime();
    life.begin();
    return life;
  };
  const send = (box: Lifetime, reply: Promise<void>, sent: string) => reply.then(box.bind(() => (lines = settled(lines, { kind: "asked" }, sent))));

  lines = { ...linesPicked(lines, LINES_5_7), draft: "Question A" };
  const first = openBox();
  let answerFirst!: () => void;
  const firstSent = send(first, new Promise<void>((resolve) => (answerFirst = resolve)), "Question A");
  // Other lines while the send is in flight: the box moves there, drawn afresh, with the draft.
  lines = { ...linesPicked(lines, LINES_20_22), draft: "Draft B, not sent" };
  first.end();
  const second = openBox();
  const moved = lines;

  answerFirst();
  await firstSent;

  assert.equal(lines, moved);
  assert.deepEqual([lines.box?.kind === "lines" && lines.box.at, lines.box?.stage, lines.draft], [LINES_20_22, { kind: "writing", sent: null }, "Draft B, not sent"]);

  await send(second, Promise.resolve(), "Draft B, not sent");

  assert.deepEqual([lines.box?.stage, lines.draft], [{ kind: "done", outcome: { kind: "asked" } }, ""]);
});

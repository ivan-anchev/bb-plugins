import assert from "node:assert/strict";
import { test } from "node:test";
import type { SelectedLineRange } from "@pierre/diffs";
import { selectionPicked, type LineSelection } from "./diff/line-selection.ts";
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

// The selection panel's ask box, as AskAboutLines wires it: each box is mounted with its own
// lifetime, and its Send's success opens Review chat and clears the lines, through that lifetime.
// A box, and the draft it holds, stays mounted exactly while its selection does.
test("a question sent from a box that was then cancelled leaves a newer selection, its box and its draft alone", async () => {
  let selection: LineSelection = null;
  let chatOpened = 0;
  const openBox = () => {
    selection = selection && { ...selection, panel: "ask" };
    const life = lifetime();
    life.begin();
    return life;
  };
  const send = (box: Lifetime, reply: Promise<void>) =>
    reply.then(
      box.bind(() => {
        chatOpened++;
        selection = null;
      }),
    );

  selection = selectionPicked(selection, LINES_5_7);
  const first = openBox();
  let answerFirst!: () => void;
  const firstSent = send(first, new Promise<void>((resolve) => (answerFirst = resolve)));
  // Cancel while the send is in flight: the box unmounts, back to the action row.
  first.end();
  selection = selection && { ...selection, panel: "actions" };
  // Other lines, and a new box with a question not sent yet.
  selection = selectionPicked(selection, LINES_20_22);
  const second = openBox();
  const secondSelection = selection;

  answerFirst();
  await firstSent;

  assert.equal(selection, secondSelection);
  assert.deepEqual(selection, { range: LINES_20_22, panel: "ask" });
  assert.equal(chatOpened, 0);

  await send(second, Promise.resolve());

  assert.equal(selection, null);
  assert.equal(chatOpened, 1);
});

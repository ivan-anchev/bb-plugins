import assert from "node:assert/strict";
import { test } from "node:test";
import { activeQuery, insertAtSign, insertToken, linkedThreads, removeToken, toNoteBody, type PickedThread } from "./mention-text.ts";

const BURN: PickedThread = { threadId: "thr_burn", title: "Burn" };
const BURN_WEEKLY: PickedThread = { threadId: "thr_weekly", title: "Burn weekly" };
const LINKS_WITH_AT: PickedThread = { threadId: "thr_links", title: "Links with @" };

const atEnd = (text: string) => ({ text, caret: text.length });

test("the query is what follows an @ before the caret, on the same line", () => {
  assert.equal(activeQuery(atEnd("check @bu"), []), "bu");
  assert.equal(activeQuery(atEnd("check @"), []), "");
  assert.equal(activeQuery({ text: "check @bu later", caret: 9 }, []), "bu");
  assert.equal(activeQuery({ text: "check @bu", caret: 5 }, []), null);
  assert.equal(activeQuery({ text: "@bu", caret: 0 }, []), null);
  assert.equal(activeQuery(atEnd("check @bu\nlater"), []), null);
  assert.equal(activeQuery(atEnd("no at sign"), []), null);
});

test("past a picked thread's token the query is closed, so typing on does not reopen the picker", () => {
  assert.equal(activeQuery(atEnd("check @Burn weekly "), [BURN_WEEKLY]), null);
  assert.equal(activeQuery(atEnd("check @Burn weekly later"), [BURN_WEEKLY]), null);
  assert.equal(activeQuery(atEnd("check @Burn weekly"), [BURN_WEEKLY]), "Burn weekly");
  assert.equal(activeQuery(atEnd("check @Burn weekly and @to"), [BURN_WEEKLY]), "to");
});

test("an @ inside a picked title belongs to its token, so picking it closes the picker", () => {
  const afterPick = insertToken(atEnd("check @Li"), [], LINKS_WITH_AT);

  assert.deepEqual(afterPick, atEnd("check @Links with @ "));
  assert.equal(activeQuery(afterPick, [LINKS_WITH_AT]), null);
  assert.equal(activeQuery(atEnd("check @Links with @ later"), [LINKS_WITH_AT]), null);
  assert.equal(activeQuery(atEnd("check @Links with @ and @to"), [LINKS_WITH_AT]), "to");
});

test("at the end of a picked title with an @, the query is the whole title, and picking replaces the whole token", () => {
  const draft = atEnd("check @Links with @");

  assert.equal(activeQuery(draft, [LINKS_WITH_AT]), "Links with @");
  assert.deepEqual(insertToken(draft, [LINKS_WITH_AT], LINKS_WITH_AT), atEnd("check @Links with @ "));
});

test("picking replaces the query with the token and a space, and moves the caret after them", () => {
  const picked = insertToken({ text: "check @bu later", caret: 9 }, [], BURN_WEEKLY);

  assert.deepEqual(picked, { text: "check @Burn weekly  later", caret: 19 });
  assert.equal(picked.text.slice(0, picked.caret), "check @Burn weekly ");
});

test("a title with a $ is written as is", () => {
  assert.equal(insertToken(atEnd("@co"), [], { threadId: "thr_cost", title: "Cut $& costs" }).text, "@Cut $& costs ");
});

test("the @ button types an @, after a space when it would touch a word", () => {
  assert.deepEqual(insertAtSign(atEnd("")), { text: "@", caret: 1 });
  assert.deepEqual(insertAtSign(atEnd("check ")), { text: "check @", caret: 7 });
  assert.deepEqual(insertAtSign({ text: "check later", caret: 5 }), { text: "check @ later", caret: 7 });
});

test("saving trims the text and shifts every mention onto the trimmed text", () => {
  const body = toNoteBody("  \n check @Burn weekly later \n", [BURN_WEEKLY]);

  assert.deepEqual(body, { text: "check @Burn weekly later", mentions: [{ threadId: "thr_weekly", from: 6, to: 18 }] });
  assert.equal(body.text.slice(6, 18), "@Burn weekly");
});

test("a title holding another links the longer token where both match, the shorter elsewhere", () => {
  const body = toNoteBody("@Burn weekly and @Burn", [BURN, BURN_WEEKLY]);

  assert.deepEqual(body.mentions, [
    { threadId: "thr_weekly", from: 0, to: 12 },
    { threadId: "thr_burn", from: 17, to: 22 },
  ]);
  assert.deepEqual(linkedThreads(body.text, [BURN, BURN_WEEKLY]), [BURN_WEEKLY, BURN]);
});

test("a thread linked twice saves a mention per token and shows one chip", () => {
  const text = "@Burn weekly vs last @Burn weekly";
  const picked = [BURN_WEEKLY, BURN_WEEKLY];

  assert.deepEqual(toNoteBody(text, picked).mentions, [
    { threadId: "thr_weekly", from: 0, to: 12 },
    { threadId: "thr_weekly", from: 21, to: 33 },
  ]);
  assert.deepEqual(linkedThreads(text, picked), [BURN_WEEKLY]);
});

test("a token typed by hand that matches a picked title is a link too", () => {
  const picked = [BURN_WEEKLY];
  const typedByHand = "@Burn weekly, then again: @Burn weekly";

  assert.deepEqual(
    toNoteBody(typedByHand, picked).mentions.map(({ from }) => from),
    [0, 26],
  );
});

test("of two picked threads with the same title, the later pick owns the token", () => {
  const renamedTwin: PickedThread = { threadId: "thr_twin", title: "Burn weekly" };

  assert.deepEqual(toNoteBody("@Burn weekly", [BURN_WEEKLY, renamedTwin]).mentions, [{ threadId: "thr_twin", from: 0, to: 12 }]);
  assert.deepEqual(linkedThreads("@Burn weekly", [BURN_WEEKLY, renamedTwin]), [renamedTwin]);
});

test("editing a token's text unlinks its thread", () => {
  assert.deepEqual(linkedThreads("check @Burn weekly later", [BURN_WEEKLY]), [BURN_WEEKLY]);
  assert.deepEqual(linkedThreads("check @Burn weekl later", [BURN_WEEKLY]), []);
  assert.deepEqual(toNoteBody("check @Burn weekl later", [BURN_WEEKLY]).mentions, []);
});

test("a chip's × removes every token of its thread with the space after it, and keeps the caret in place", () => {
  const draft = { text: "@Burn weekly vs @Burn and @Burn weekly then", caret: 43 };
  const unlinked = removeToken(draft, [BURN, BURN_WEEKLY], BURN_WEEKLY);

  assert.deepEqual(unlinked, { text: "vs @Burn and then", caret: 17 });
  assert.deepEqual(linkedThreads(unlinked.text, [BURN, BURN_WEEKLY]), [BURN]);
});

test("a caret inside a removed token lands where the token was", () => {
  assert.deepEqual(removeToken({ text: "see @Burn now", caret: 7 }, [BURN], BURN), { text: "see now", caret: 4 });
});

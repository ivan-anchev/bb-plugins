import "../../../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Worker } from "node:worker_threads";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { COORDINATOR } from "../../test-tab.ts";
import type { PageStep } from "./reloaded-page.ts";
import { OPTIONS, openQuestion, press, watchFocusDrops } from "./test-question.ts";

// An open question answered from its card in the issue's feed: by an option's row, pressed or by its
// number, or in the user's own words, which the browser keeps until the answer lands. Focus stays in
// the card throughout, never dropping to the page.

afterEach(() => {
  cleanup();
  // why: the own-words field keeps its draft in the browser, by decision.
  localStorage.clear();
});

/**
 * Each settled row as drawn: whether a check glyph sits in it, anywhere, and whether it has the
 * selected look, each read on its own so an extra check or an extra selected row shows.
 */
const drawn = (card: HTMLElement) =>
  within(card)
    .getAllByRole("listitem")
    .map((row) => ({ check: row.querySelector(".rmi-result-glyph[data-result='pass']") !== null, selected: row.hasAttribute("data-chosen") }));

/** The rows drawn with option `n` (1-based) chosen, among OPTIONS. */
const chosen = (n: number) => OPTIONS.map((_, i) => ({ check: i === n - 1, selected: i === n - 1 }));
const NONE_CHOSEN = OPTIONS.map(() => ({ check: false, selected: false }));

test("an open question's rows are numbered, the recommended one tagged so, then a last row for the user's own words", async () => {
  const { card, rows, field } = await openQuestion();
  assert.deepEqual(
    rows().map((row) => [row.getAttribute("aria-keyshortcuts"), row.querySelector(".rmi-q-key")?.textContent, row.textContent?.includes("Recommended")]),
    [
      ["1", "1", true],
      ["2", "2", false],
      ["3", "3", false],
    ],
  );
  assert.equal(field().getAttribute("aria-keyshortcuts"), "4");
  assert.equal(field().placeholder, "Something else…");
  assert.equal(within(card()).queryByRole("button", { name: "Send" }), null, "Send shows only once the user types");
});

test("pressing option 2's number sends it: Sending… shows on that row alone, then the answer marks that row with a ✓ and the selected look and no other, and focus never drops to the page", async () => {
  const { card, rows, answers, answered } = await openQuestion();
  card().focus();
  const focus = watchFocusDrops();
  press("2");
  await waitFor(() => assert.deepEqual(answers, [{ coordinatorId: COORDINATOR.id, decisionId: "d9", answer: "Five" }]));
  assert.deepEqual(
    rows().map((row) => within(row).queryByRole("status")?.textContent ?? null),
    [null, "Sending…", null],
    "Sending… on the pressed row only",
  );
  assert.deepEqual(
    rows().map((row) => row.getAttribute("aria-disabled")),
    ["true", "true", "true"],
    "no row presses while it sends, and none is disabled",
  );
  assert.equal(rows()[1]?.querySelector(".rmi-q-key .rmi-q-spin") !== null, true, "its number turns into a spinner");
  assert.equal(document.activeElement, card(), "focus stays where the key was pressed");
  press("3");
  assert.equal(answers.length, 1, "one answer at a time");

  await answered("Five");
  await waitFor(() => assert.deepEqual(drawn(card()), chosen(2)));
  assert.equal(card().querySelectorAll(".rmi-result-glyph").length, 1, "one check in the whole card");
  assert.equal(within(card()).queryAllByRole("button").length, 0, "an answered question offers nothing to press");
  assert.equal(within(card()).queryByRole("textbox"), null, "nor a field");
  assert.equal(focus.dropped(), false, "focus never dropped to the page");
  focus.stop();
});

test("focus on the row pressed moves straight to the card once the answer lands, never through the page", async () => {
  const { card, rows, answers, answered } = await openQuestion();
  const second = rows()[1] ?? assert.fail("no option 2");
  second.focus();
  const focus = watchFocusDrops();
  fireEvent.click(second);
  await waitFor(() => assert.equal(answers.length, 1));
  assert.equal(document.activeElement, second, "the pressed row keeps focus while it sends");
  await answered("Five");
  await waitFor(() => assert.deepEqual(drawn(card()), chosen(2)));
  assert.equal(document.activeElement, card());
  assert.equal(focus.dropped(), false, "focus never dropped to the page");
  focus.stop();
});

test("words typed into the last row that match an option's say Sending… on the last row, which sent them", async () => {
  const { card, rows, field, answers } = await openQuestion();
  fireEvent.change(field(), { target: { value: "Five" } });
  field().focus();
  press("Enter");
  await waitFor(() => assert.equal(answers.length, 1));
  const own = field().closest("form") ?? assert.fail("no own-words row");
  assert.equal(within(own).getByRole("status").textContent, "Sending…");
  assert.ok(own.hasAttribute("data-sending"), "the last row stays at full strength");
  assert.deepEqual(
    rows().map((row) => row.hasAttribute("data-sending")),
    [false, false, false],
    "no option row says it sends",
  );
  assert.equal(within(card()).getAllByRole("status").length, 1);
});

test("in the card, the number after the options goes to the field, ↑ and ↓ move between rows, and digits typed in the field stay text", async () => {
  const { card, rows, field, answers } = await openQuestion();
  card().focus();
  press("4");
  assert.equal(document.activeElement, field(), "N+1 goes to the field");
  press("2");
  assert.deepEqual(answers, [], "a digit in the field answers nothing");
  press("ArrowUp");
  assert.equal(document.activeElement, rows()[2], "↑ at the field's start goes to the last option");
  press("ArrowUp");
  press("ArrowUp");
  assert.equal(document.activeElement, rows()[0]);
  press("ArrowUp");
  assert.equal(document.activeElement, rows()[0], "the first row is the top");
  press("ArrowDown");
  assert.equal(document.activeElement, rows()[1]);
});

test("focus on Send is on the last row: ↑ goes to the last option and ↓ goes nowhere", async () => {
  const { card, rows, field } = await openQuestion();
  fireEvent.change(field(), { target: { value: "Four" } });
  const send = within(card()).getByRole("button", { name: "Send" });
  send.focus();
  press("ArrowDown");
  assert.equal(document.activeElement, send, "nothing is below the last row");
  press("ArrowUp");
  assert.equal(document.activeElement, rows()[2]);
});

/** Plays `step` in a page of its own, as a reload makes one: its own document and modules, and the storage given. */
function inPage(step: PageStep): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const page = new Worker(new URL("./reloaded-page.ts", import.meta.url), { workerData: step });
    page.once("message", resolve);
    page.once("error", reject);
  });
}

test("words typed into the own-words field survive a reload and send with Enter: Sending… shows on that row, then the words show once, and focus never drops to the page", async () => {
  const words = "Four, with a cap of 30 s";
  const typed = await inPage({ step: "type", words, storage: [] });
  assert.ok(typed !== null && typeof typed === "object" && "storage" in typed && Array.isArray(typed.storage));

  const reloaded = await inPage({ step: "send", words, storage: typed.storage });
  assert.deepEqual(reloaded, {
    kept: words,
    sending: { answers: [{ coordinatorId: COORDINATOR.id, decisionId: "d9", answer: words }], status: "Sending…", readOnly: true, focusInField: true },
    answered: { shown: 1, focusOnCard: true, dropped: false },
  });
});

test("a question with no options is answered in the card's field alone, numbered 1, with no pointer to the Board", async () => {
  const { card, field, answers } = await openQuestion([]);
  assert.equal(field().getAttribute("aria-label"), "Your answer");
  assert.equal(field().getAttribute("aria-keyshortcuts"), "1");
  assert.doesNotMatch(card().textContent ?? "", /Needs you|Board/);
  fireEvent.change(field(), { target: { value: "Ship it" } });
  fireEvent.click(within(card()).getByRole("button", { name: "Send" }));
  await waitFor(() => assert.deepEqual(answers, [{ coordinatorId: COORDINATOR.id, decisionId: "d9", answer: "Ship it" }]));
});

test("an answered card draws its rows as the open card did: none chosen for an answer in the user's own words", async () => {
  const { card, answered } = await openQuestion();
  await answered("Eight");
  await waitFor(() => assert.deepEqual(drawn(card()), NONE_CHOSEN));
});

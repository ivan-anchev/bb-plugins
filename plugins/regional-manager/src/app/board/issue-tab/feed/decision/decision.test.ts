import "../../../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { IssueFeed } from "../../../../../contract.ts";
import { decisionIdSchema, type AskedDecision } from "../../../../../model/decision.ts";
import { COORDINATOR, FEED, issue, opened } from "../../test-tab.ts";

// An open question answered from its card in the issue's feed: by an option's row, pressed or by its
// number, or in the user's own words, which the browser keeps until the answer lands. Focus stays in
// the card throughout, never dropping to the page.

afterEach(() => {
  cleanup();
  // why: the own-words field keeps its draft in the browser, by decision.
  localStorage.clear();
});

const WEB_1 = [issue("WEB-1", { status: "in-progress", headline: "Round 3 running" })];
const OPTIONS = ["Three", "Five", "Seven"];

/** d9, "How many retries?", with OPTIONS (or `options`), Three recommended, answered with `answer` (null: open). */
function asking(answer: string | null, options = OPTIONS): AskedDecision {
  return {
    kind: "asked",
    id: decisionIdSchema.parse("d9"),
    question: "How many retries?",
    options,
    recommended: options.includes("Three") ? "Three" : null,
    at: 6_400,
    answer: answer === null ? null : { text: answer, at: 6_500 },
    cap: null,
  };
}

/** FEED with d9 at its end. */
const feedWith = (decision: AskedDecision) => (): IssueFeed => ({ ...FEED, entries: [...FEED.entries, { kind: "decision", decision }] });

/** The tab open on WEB-1 with d9 open, and its card, its rows and its field as they are now. */
async function openQuestion(options = OPTIONS) {
  const mounted = await opened("WEB-1", WEB_1, { feedOf: feedWith(asking(null, options)) });
  const card = () => mounted.tab().getByRole("article", { name: "Question d9" });
  return {
    ...mounted,
    card,
    /** The option rows, each a button, in order. */
    rows: () => within(card()).getAllByRole("button").filter((button) => button.closest("form") === null),
    field: (): HTMLTextAreaElement => {
      const field = within(card()).getByRole("textbox");
      assert.ok(field instanceof HTMLTextAreaElement);
      return field;
    },
    /** The feed reads d9 answered with `text`. */
    answered: (text: string) => mounted.refeed("WEB-1", feedWith(asking(text, options))),
  };
}

/** Presses `key` where focus is, as the browser sends it. */
const press = (key: string) => fireEvent.keyDown(document.activeElement ?? assert.fail("nothing has focus"), { key });

/** Whether focus is on the page itself, which a screen reader and the keyboard lose their place on. */
const onPage = () => document.activeElement === null || document.activeElement === document.body;

/** Each settled row's marker as drawn: ✓ for a row with the check glyph in its slot and the selected look, "" for one without. */
const markers = (card: HTMLElement) =>
  within(card)
    .getAllByRole("listitem")
    .map((row) => (row.querySelector(".rmi-q-key > .rmi-result-glyph[data-result='pass']") !== null && row.hasAttribute("data-chosen") ? "✓" : ""));

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

test("pressing option 2's number sends it: Sending… shows on that row alone, then the answer marks that row with a ✓ and no other, and focus never drops to the page", async () => {
  const { card, rows, answers, answered } = await openQuestion();
  card().focus();
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
  await waitFor(() => assert.deepEqual(markers(card()), ["", "✓", ""]));
  assert.equal(within(card()).queryAllByRole("button").length, 0, "an answered question offers nothing to press");
  assert.equal(within(card()).queryByRole("textbox"), null, "nor a field");
  assert.ok(!onPage(), "focus never drops to the page");
});

test("focus on the row pressed moves to the card once the answer lands, never the page", async () => {
  const { card, rows, answers, answered } = await openQuestion();
  const second = rows()[1] ?? assert.fail("no option 2");
  second.focus();
  fireEvent.click(second);
  await waitFor(() => assert.equal(answers.length, 1));
  assert.equal(document.activeElement, second, "the pressed row keeps focus while it sends");
  await answered("Five");
  await waitFor(() => assert.deepEqual(markers(card()), ["", "✓", ""]));
  assert.equal(document.activeElement, card());
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

test("words typed into the own-words field survive a reload and send with Enter: Sending… shows on that row, then the words show once, and focus never drops to the page", async () => {
  const typed = "Four, with a cap of 30 s";
  const first = await openQuestion();
  fireEvent.change(first.field(), { target: { value: typed } });
  cleanup();

  const { card, field, answers, answered } = await openQuestion();
  assert.equal(field().value, typed, "the draft is kept through a reload");
  assert.ok(within(card()).getByRole("button", { name: "Send" }), "Send shows for the words typed");
  field().focus();
  press("Enter");
  await waitFor(() => assert.deepEqual(answers, [{ coordinatorId: COORDINATOR.id, decisionId: "d9", answer: typed }]));
  const own = field().closest("form") ?? assert.fail("no own-words row");
  assert.equal(within(own).getByRole("status").textContent, "Sending…");
  assert.equal(field().readOnly, true, "the field holds still while it sends");
  assert.equal(document.activeElement, field(), "focus stays in the field");

  await act(() => answered(typed));
  await waitFor(() => assert.match(card().textContent ?? "", /You answered/));
  assert.equal((card().textContent ?? "").split(typed).length - 1, 1, "the words show once");
  assert.deepEqual(markers(card()), ["", "", ""], "no option marked");
  assert.equal(document.activeElement, card(), "focus moves from the field to the card");
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

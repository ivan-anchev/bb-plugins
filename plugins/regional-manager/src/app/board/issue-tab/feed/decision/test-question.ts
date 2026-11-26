// Tests only: WEB-1's tab with an open question d9 in its feed, its card's rows and field as they are
// now, and a watch on focus dropping to the page. Shared by decision.test.ts and the reloaded page it
// starts (reloaded-page.ts).
import "../../../../test-browser.ts";
import assert from "node:assert/strict";
import { fireEvent, within } from "@testing-library/react";
import type { IssueFeed } from "../../../../../contract.ts";
import { decisionIdSchema, type AskedDecision } from "../../../../../model/decision.ts";
import { FEED, issue, opened } from "../../test-tab.ts";

const WEB_1 = [issue("WEB-1", { status: "in-progress", headline: "Round 3 running" })];
export const OPTIONS = ["Three", "Five", "Seven"];

/** d9, "How many retries?", with OPTIONS (or `options`), Three recommended, answered with `answer` (null: open). */
function asking(answer: string | null, options: readonly string[]): AskedDecision {
  return {
    kind: "asked",
    id: decisionIdSchema.parse("d9"),
    question: "How many retries?",
    options: [...options],
    recommended: options.includes("Three") ? "Three" : null,
    at: 6_400,
    answer: answer === null ? null : { text: answer, at: 6_500 },
    cap: null,
  };
}

/** FEED with d9 at its end. */
const feedWith = (decision: AskedDecision) => (): IssueFeed => ({ ...FEED, entries: [...FEED.entries, { kind: "decision", decision }] });

/** The tab open on WEB-1 with d9 open, and its card, its rows and its field as they are now. */
export async function openQuestion(options: readonly string[] = OPTIONS) {
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
export const press = (key: string) => fireEvent.keyDown(document.activeElement ?? assert.fail("nothing has focus"), { key });

/**
 * Watches focus from now on: `dropped()` is true once anything takes focus while the page itself has
 * it, which is how a card recovers focus its rows dropped, or once the page has it now.
 */
export function watchFocusDrops() {
  let dropped = false;
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (onPage()) dropped = true;
    focus.call(this, options);
  };
  return {
    dropped: () => dropped || onPage(),
    stop: () => {
      HTMLElement.prototype.focus = focus;
    },
  };
}

const onPage = () => document.activeElement === null || document.activeElement === document.body;

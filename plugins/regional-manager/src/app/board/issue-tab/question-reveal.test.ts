import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { coordinatorContract, type IssueRow } from "../../../contract.ts";
import { decisionIdSchema, type Decision } from "../../../model/decision.ts";
import { PROJECT, sidebarThread } from "../../test-sidebar.ts";
import { agent, COORDINATOR, FEED, id, issue, MANAGER_NAME, opened } from "./test-tab.ts";

// Pressing an issue's row under Needs you on the Board opens the issue's tab at the question it waits
// on: the card scrolled to the middle of the tab, ringed, focus on its first option. FEED's open
// question is d2, "Ship #219 to everyone now?", on WEB-1.

const { Board } = await import("../board.tsx");

/** Each card the browser was asked to scroll into view, with how. why: jsdom scrolls nothing. */
let scrolled: { card: string | null; options: unknown }[] = [];
Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
  scrolled.push({ card: this.getAttribute("aria-label"), options });
};

afterEach(() => {
  cleanup();
  scrolled = [];
});

const ASKING = "Ship #219 to everyone now?";
const D2: Decision = { id: decisionIdSchema.parse("d2"), issueId: id("WEB-1"), question: ASKING, options: ["Ship now", "Wait a day"], recommended: null, askedAt: 6_300, answer: null, cap: null };
const WEB_1 = issue("WEB-1", { status: "in-progress", needsYou: ASKING, headline: "Round 3 running", agent: agent("a2") });
const BLOCKED = "Blocked: Needs a staging key";

/** The Board in COORDINATOR's thread, its board read answering `issues` and `decisions`. */
async function board(issues: readonly IssueRow[], decisions: readonly Decision[]) {
  const view = renderSlot({ component: Board }, { coordinatorId: COORDINATOR.id }, {
    experimental_rpcContract: coordinatorContract,
    experimental_panel: { openTab: () => true },
    sidebarThreads: { status: "ready", threads: [sidebarThread(COORDINATOR.threadId, MANAGER_NAME)], projects: [PROJECT] },
    rpc: {
      board: () => ({ verify: true, ownEdits: null, prUnavailable: null, decisions, issues }),
      coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }),
      setVerify: () => ({}),
    },
  });
  const row = await within(await view.findByRole("region", { name: /^Needs you/ })).findByRole("button", { name: /^WEB-1:/ });
  return { view, press: () => fireEvent.click(row) };
}

/** Where focus is: the label of the question card it is in and the key of the row it is on; nulls outside a card. */
function focusIn() {
  const active = document.activeElement;
  return { card: active?.closest(".rmi-decision")?.getAttribute("aria-label") ?? null, row: active?.getAttribute("aria-keyshortcuts") ?? null };
}

test("pressing an issue's row under Needs you opens its tab at its waiting question: in the middle of the tab, ringed, focus on its first option, whose number answers", async () => {
  const pressed = await board([WEB_1], [D2]);
  pressed.press();
  assert.deepEqual(
    pressed.view.experimental_panelCalls.map((call) => (call.method === "openTab" ? call.options.params : call.method)),
    [{ issueId: "WEB-1" }],
    "the tab's params name the issue alone, so the issue keeps one tab",
  );

  const tab = await opened("WEB-1", [WEB_1]);
  await waitFor(() => assert.deepEqual(focusIn(), { card: "Question d2", row: "1" }));
  assert.equal(document.activeElement?.textContent, "1Ship now");
  assert.deepEqual(scrolled, [{ card: "Question d2", options: { block: "center" } }]);
  assert.ok(tab.tab().getByRole("article", { name: "Question d2" }).hasAttribute("data-revealed"), "ringed");

  fireEvent.keyDown(document.activeElement ?? assert.fail("no focus"), { key: "2" });
  await waitFor(() => assert.deepEqual(tab.answers, [{ coordinatorId: COORDINATOR.id, decisionId: "d2", answer: "Wait a day" }]));
});

test("a tab open already shows its question when its row is pressed, and shows Activity whole if Rounds was hiding it", async () => {
  const tab = await opened("WEB-1", [WEB_1]);
  fireEvent.click(tab.tab().getByRole("button", { name: "Rounds" }));
  assert.equal(tab.tab().queryByRole("article", { name: "Question d2" }), null);
  assert.deepEqual(focusIn(), { card: null, row: null }, "opening the tab alone moves no focus");

  (await board([WEB_1], [D2])).press();
  await waitFor(() => assert.deepEqual(focusIn(), { card: "Question d2", row: "1" }));
  assert.equal(tab.tab().getByRole("button", { name: "All" }).getAttribute("aria-pressed"), "true");
});

test("a row under Needs you that no question waits on opens its tab as any row does, and a later opening reveals nothing either", async () => {
  const blocked = { ...WEB_1, needsYou: BLOCKED, headline: BLOCKED };
  (await board([blocked], [])).press();
  await opened("WEB-1", [blocked]);
  assert.deepEqual([focusIn(), scrolled], [{ card: null, row: null }, []]);
});

test("a question answered before its tab opens is taken as shown: the tab opens on nothing, and opening it again moves no focus", async () => {
  (await board([WEB_1], [D2])).press();
  const answered = { ...FEED, entries: FEED.entries.map((entry) => (entry.kind === "decision" && entry.decision.kind === "asked" && entry.decision.id === "d2" ? { ...entry, decision: { ...entry.decision, answer: { text: "Ship now", at: 7_000 } } } : entry)) };
  await opened("WEB-1", [WEB_1], { feedOf: () => answered });
  cleanup();

  await opened("WEB-1", [WEB_1]);
  assert.deepEqual([focusIn(), scrolled], [{ card: null, row: null }, []], "the request went with the first opening");
});

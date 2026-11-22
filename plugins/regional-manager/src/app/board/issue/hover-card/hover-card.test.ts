import "../../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createElement } from "react";
import type { IssueRow } from "../../../../contract.ts";
import { agentIdSchema } from "../../../../model/agent.ts";
import { issueIdSchema } from "../../../../model/issue/issue.ts";

// A row's hover card on the board, driven as the user drives it: keyboard focus opens it at once and
// Escape closes it wherever focus is; the pointer resting on a row opens it after half a second, and
// on the next row at once; leaving, or a press, puts it away. It shows what the row leaves out.

// why: jsdom has none; the rows measure their titles.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const { IssueBoard } = await import("../issue-board.tsx");

afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const id = (raw: string) => issueIdSchema.parse(raw);

function issue(raw: string, fields: Partial<IssueRow>): IssueRow {
  return { id: id(raw), kind: "build", parentId: null, subIssues: null, blockedBy: [], blocks: [], title: `Issue ${raw}`, status: "todo", needsYou: null, headline: "Not started", agent: null, pr: null, ...fields };
}

const ASK = "Blocked: Slack or email for the daily digest? I need one before I wire the sender.";

/** A parent at 1 of 2 with a flagged sub-issue; WEB-4 in review, blocking WEB-5. */
const ISSUES: IssueRow[] = [
  issue("WEB-1", { title: "Regional manager 0.7", status: "in-progress", subIssues: { done: 1, total: 2 }, headline: null }),
  issue("WEB-2", { parentId: id("WEB-1"), status: "done", headline: "Merged #12" }),
  issue("WEB-3", { parentId: id("WEB-1"), status: "in-progress", needsYou: ASK, headline: ASK, agent: { id: agentIdSchema.parse("a17"), threadId: "thr_a17" } }),
  issue("WEB-4", { title: "Carry what each issue blocks", status: "in-review", headline: "✓ Verified: 4 of 4 criteria passed", agent: { id: agentIdSchema.parse("a14"), threadId: "thr_a14" }, blocks: [id("WEB-5")] }),
  issue("WEB-5", { title: "Draw the blocking badges", blockedBy: [id("WEB-4")] }),
];

function mount() {
  const view = renderSlot({ component: IssueBoard }, { decisions: [], issues: ISSUES, decisionRow: () => null }, { experimental_panel: { openTab: () => true } });
  const row = (raw: string, lane: RegExp) => within(view.getByRole("region", { name: lane })).getByRole("button", { name: new RegExp(`^${raw}:`) });
  /** The card shown, as its lines read; null: none. */
  const card = () => {
    const shown = view.container.querySelectorAll<HTMLElement>(".rmi-card");
    assert.ok(shown.length <= 1, "one card at a time");
    const [only] = shown;
    const body = only?.querySelector(".rmi-card-body");
    return only === undefined ? null : { on: only.closest(".rmi-rowbox")?.querySelector(".rmi-row-id")?.textContent, lines: [...(body?.children ?? [])].map((part) => part.textContent) };
  };
  return { view, row, card };
}

test("keyboard focus on a row opens its card at once, with what the row leaves out; Escape closes it wherever focus is, holding bb's Escape, and focus stays on the row", () => {
  const { row, card } = mount();
  const reviewed = row("WEB-4", /^In review/);
  act(() => reviewed.focus());

  assert.deepEqual(card(), {
    on: "WEB-4",
    lines: ["Carry what each issue blocks", "In review · a14", "✓ Verified: 4 of 4 criteria passed", "Blocks WEB-5", "BlocksWEB-5Draw the blocking badges"],
  });

  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => reviewed.dispatchEvent(escape));
  assert.equal(card(), null);
  assert.equal(escape.defaultPrevented, true, "bb's own Escape, which leaves the page, skips it");
  assert.ok(document.activeElement === reviewed, "focus stays on the row");

  const later = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => reviewed.dispatchEvent(later));
  assert.equal(later.defaultPrevented, false, "with no card, Escape is bb's again");
});

test("a parent's card counts its sub-issues and hangs them from its heading on the board's rails; a flagged one's leads with what it waits on the user for", () => {
  const { view, row, card } = mount();
  act(() => row("WEB-1", /^In progress/).focus());
  assert.deepEqual(card()?.lines, ["Regional manager 0.7", "In progress", "1 of 2 done", "Sub-issuesWEB-2Issue WEB-2WEB-3Issue WEB-3"]);
  const tree = view.container.querySelectorAll(".rmi-card .rmi-card-tree > li");
  assert.deepEqual(
    [...tree].map((item) => [item.querySelector(".rmi-card-id")?.textContent, item.querySelector(".rmi-rails path")?.getAttribute("d")]),
    [
      ["WEB-2", "M4.5 -2V7A4 4 0 0 0 8.5 11H14M4.5 7V22"],
      ["WEB-3", "M4.5 0V7A4 4 0 0 0 8.5 11H14"],
    ],
    "the first reaches up to the heading, each bends in, and the last stops",
  );

  act(() => row("WEB-3", /^Needs you/).focus());
  assert.deepEqual(card(), { on: "WEB-1›WEB-3", lines: ["Issue WEB-3", "In progress · a17", `Needs you${ASK}`] }, "the flat row's own card, not its copy's under the parent");
});

test("the pointer resting on a row opens its card after half a second, the next row's at once, and leaving closes it after a beat", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { row, card } = mount();
  const box = (raw: string, lane: RegExp) => row(raw, lane).closest(".rmi-rowbox") ?? assert.fail("no row box");

  fireEvent.pointerEnter(box("WEB-4", /^In review/));
  act(() => mock.timers.tick(499));
  assert.equal(card(), null, "not while the pointer only passes");
  act(() => mock.timers.tick(1));
  assert.equal(card()?.on, "WEB-4");

  fireEvent.pointerLeave(box("WEB-4", /^In review/));
  fireEvent.pointerEnter(box("WEB-5", /^Todo/));
  assert.equal(card()?.on, "WEB-5", "once one shows, the next opens at once");

  fireEvent.pointerLeave(box("WEB-5", /^Todo/));
  act(() => mock.timers.tick(149));
  assert.equal(card()?.on, "WEB-5", "time to cross onto the card");
  act(() => mock.timers.tick(1));
  assert.equal(card(), null);
});

test("a focused row that leaves the board takes its card's hold with it: hovering another row opens that row's card", () => {
  const { view, row, card } = mount();
  act(() => row("WEB-4", /^In review/).focus());
  assert.equal(card()?.on, "WEB-4");

  const without = ISSUES.filter(({ id: issueId }) => issueId !== "WEB-4").map((row) => (row.id === "WEB-5" ? { ...row, blockedBy: [] } : row));
  view.lifecycle.rerender(createElement(IssueBoard, { decisions: [], issues: without, decisionRow: () => null }));
  assert.equal(card(), null, "its card went with it");

  mock.timers.enable({ apis: ["setTimeout"] });
  const box = row("WEB-5", /^Todo/).closest(".rmi-rowbox") ?? assert.fail("no row box");
  fireEvent.pointerEnter(box);
  act(() => mock.timers.tick(1_000));
  assert.equal(card()?.on, "WEB-5");
});

test("a hovered row that moves lanes leaves its card behind for good: blurring another row opens none for it", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { view, row, card } = mount();
  fireEvent.pointerEnter(row("WEB-5", /^Todo/).closest(".rmi-rowbox") ?? assert.fail("no row box"));
  act(() => mock.timers.tick(500));
  assert.equal(card()?.on, "WEB-5");

  const moved = ISSUES.map((issue) => (issue.id === "WEB-5" ? { ...issue, status: "in-progress" as const } : issue));
  view.lifecycle.rerender(createElement(IssueBoard, { decisions: [], issues: moved, decisionRow: () => null }));
  act(() => row("WEB-4", /^In review/).focus());
  act(() => row("WEB-4", /^In review/).blur());
  act(() => mock.timers.tick(5_000));
  assert.equal(card(), null, "no card for a row the pointer left as it moved");
});

test("a press puts the card away, and the focus the press gives the row opens none", () => {
  const { row, card } = mount();
  act(() => row("WEB-4", /^In review/).focus());
  assert.equal(card()?.on, "WEB-4");

  const pressed = row("WEB-5", /^Todo/);
  fireEvent.pointerDown(pressed);
  act(() => pressed.focus());
  assert.equal(card(), null);
});

/**
 * The board laid out as the browser would: the panel it scrolls in (`data-panel`, overflow auto)
 * stands at `panel`, the row's box at `row`, and the card's content is `height` tall. why stubs:
 * jsdom lays nothing out.
 */
function laidOut({ panel, row, height }: { panel: { top: number; bottom: number }; row: { top: number; bottom: number }; height: number }): () => void {
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 360, x: 0, y: top, width: 360, height: bottom - top, toJSON: () => ({}) });
  const boxOf = HTMLElement.prototype.getBoundingClientRect;
  const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("rmi-rowbox")) return rect(row.top, row.bottom);
    if (this.dataset.panel !== undefined) return rect(panel.top, panel.bottom);
    return rect(0, 0);
  };
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get(this: HTMLElement) { return this.classList.contains("rmi-card") ? height : 0; } });
  return () => {
    HTMLElement.prototype.getBoundingClientRect = boxOf;
    if (scrollHeight !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
  };
}

/** The board inside a panel that scrolls, as the Board tab mounts it. */
function mountInPanel() {
  const Panel = () => createElement("div", { "data-panel": "", style: { overflowY: "auto" } }, createElement(IssueBoard, { decisions: [], issues: ISSUES, decisionRow: () => null }));
  const view = renderSlot({ component: Panel }, {}, { experimental_panel: { openTab: () => true } });
  const shown = () => {
    const card = view.container.querySelector<HTMLElement>(".rmi-card");
    return card === null ? null : { side: card.dataset.side, cap: card.style.getPropertyValue("--rmi-card-cap") };
  };
  return { view, shown };
}

test("a card that doesn't fit under its row at the panel's foot opens above it, whole; one that fits on neither side keeps the bigger side and scrolls inside", () => {
  const cases = [
    { name: "room below", row: { top: 100, bottom: 130 }, height: 174, want: { side: "below", cap: "" } },
    { name: "the panel's foot", row: { top: 656, bottom: 686 }, height: 174, want: { side: "above", cap: "" } },
    { name: "room on neither side, more below", row: { top: 300, bottom: 330 }, height: 600, want: { side: "below", cap: "366px" } },
    { name: "room on neither side, more above", row: { top: 450, bottom: 480 }, height: 600, want: { side: "above", cap: "446px" } },
  ];
  for (const { name, row, height, want } of cases) {
    const restore = laidOut({ panel: { top: 0, bottom: 700 }, row, height });
    try {
      const { view, shown } = mountInPanel();
      act(() => within(view.getByRole("region", { name: /^In review/ })).getByRole("button", { name: /^WEB-4:/ }).focus());
      assert.deepEqual(shown(), want, name);
      cleanup();
    } finally {
      restore();
    }
  }
});

test("a capped card's body is a labelled tab stop that scrolls; Escape there puts the card away and hands focus back to its row, never to the page", () => {
  const restore = laidOut({ panel: { top: 0, bottom: 400 }, row: { top: 150, bottom: 180 }, height: 600 });
  try {
    const { view } = mountInPanel();
    const parent = within(view.getByRole("region", { name: /^In progress/ })).getByRole("button", { name: /^WEB-1:/ });
    act(() => parent.focus());
    const body = view.getByRole("region", { name: "Details of WEB-1" });
    assert.equal(body.getAttribute("tabindex"), "0", "the element that scrolls is the one tab stop");
    assert.equal(body.closest("[aria-hidden]"), null, "and a screen reader reaches it");

    act(() => body.focus());
    act(() => body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

    assert.equal(view.container.querySelector(".rmi-card"), null, "the card is put away");
    assert.ok(document.activeElement === parent, "focus is back on its row");
  } finally {
    restore();
  }
});

test("a card that fits has no tab stop, and stays hidden from a screen reader", () => {
  const restore = laidOut({ panel: { top: 0, bottom: 700 }, row: { top: 100, bottom: 130 }, height: 174 });
  try {
    const { view } = mountInPanel();
    act(() => within(view.getByRole("region", { name: /^In review/ })).getByRole("button", { name: /^WEB-4:/ }).focus());
    const card = view.container.querySelector(".rmi-card") ?? assert.fail("no card");
    assert.deepEqual([card.getAttribute("aria-hidden"), card.querySelector("[tabindex]")], ["true", null]);
  } finally {
    restore();
  }
});

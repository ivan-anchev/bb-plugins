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

// why: jsdom has none of these; the rows measure their titles, and the working ring asks for Reduce motion and a canvas.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
HTMLCanvasElement.prototype.getContext = () => null;

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
    return only === undefined ? null : { on: only.closest(".rmi-rowbox")?.querySelector(".rmi-row-id")?.textContent, lines: [...only.children].map((part) => part.textContent) };
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

test("a parent's card counts its sub-issues and lists them; a flagged one's leads with what it waits on the user for", () => {
  const { row, card } = mount();
  act(() => row("WEB-1", /^In progress/).focus());
  assert.deepEqual(card()?.lines, ["Regional manager 0.7", "In progress", "1 of 2 done", "Sub-issuesWEB-2Issue WEB-2WEB-3Issue WEB-3"]);

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

test("a press puts the card away, and the focus the press gives the row opens none", () => {
  const { row, card } = mount();
  act(() => row("WEB-4", /^In review/).focus());
  assert.equal(card()?.on, "WEB-4");

  const pressed = row("WEB-5", /^Todo/);
  fireEvent.pointerDown(pressed);
  act(() => pressed.focus());
  assert.equal(card(), null);
});

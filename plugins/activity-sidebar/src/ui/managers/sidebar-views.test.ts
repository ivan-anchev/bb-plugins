import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import type { View } from "../../data/local-choice/choices.ts";
import type { ManagerModel } from "../../model/activity.ts";
import { project, thread } from "../../model/fixtures.ts";

// The sidebar around the threads' list, mounted as bb mounts it. The threads' list stands in as its
// scroller: its own tests are list/items.test.ts and model/activity.test.ts.

const { SidebarViews } = await import("./sidebar-views.tsx");
const { ViewMenu } = await import("../view-menu.tsx");

afterEach(cleanup);

const THREADS = createElement("div", { className: "as-scroller", tabIndex: 0, "data-threads": "" });

const manager = (id: string, createdAt: number): ManagerModel => ({
  thread: thread(id, { originPluginId: "regional-manager", createdAt, displayTitle: id }),
  look: null,
  line: null,
  current: false,
  state: null,
  project: "bb-plugins",
});
const PR = manager("PR Reviews", 1);
const SIDEBAR = manager("Sidebar", 2);

/** `managers`: the list's rows; `pinned`: the grid's tiles, none unless given. */
type Shown = { managers: readonly ManagerModel[]; pinned?: readonly ManagerModel[]; view: View };
const props = ({ managers, pinned = [], view }: Shown) => ({ managers: { pinned, unpinned: managers }, underWaySince: null, view, onView: () => {}, onNavigate: () => {}, threads: THREADS });

function mount(shown: Shown) {
  const slot = renderSlot({ component: SidebarViews }, props(shown));
  const show = (next: Shown) => act(() => slot.lifecycle.rerender(createElement(SidebarViews, props(next))));
  const threads = () => slot.container.querySelector<HTMLElement>("[data-threads]");
  return { slot, show, threads };
}

test("with no regional managers there is no segment and no tab panel: the threads' list alone", () => {
  const { slot, threads } = mount({ managers: [], view: "managers" });
  assert.equal(slot.queryByRole("tablist"), null);
  assert.equal(slot.queryByRole("tabpanel"), null);
  assert.ok(threads(), "the threads' list shows, whatever view was chosen");
});

test("with managers, each tab controls its own panel, labelled by it; only the chosen one shows, with the one keyboard stop", () => {
  for (const view of ["threads", "managers"] as const) {
    const { slot } = mount({ managers: [PR], view });
    for (const tab of slot.getAllByRole("tab")) {
      const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      assert.ok(panel, "its panel exists");
      assert.equal(panel.getAttribute("role"), "tabpanel");
      assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
      const chosen = tab.getAttribute("aria-selected") === "true";
      assert.equal(panel.hidden, !chosen, `${tab.textContent} panel hidden unless chosen`);
      assert.equal(panel.querySelectorAll(".as-scroller").length, 1, "each panel keeps its list, shown or not");
    }
    assert.equal(slot.getByRole("tab", { selected: true }).textContent, view === "threads" ? "Threads" : "Managers");
    // why: a hidden panel's contents are out of the browser's tab order; jsdom doesn't know, so they're left out here.
    const stops = Array.from(slot.container.querySelectorAll<HTMLElement>("[tabindex='0']"))
      .filter((el) => el.closest("[hidden]") === null)
      .map((el) => el.getAttribute("role") ?? el.className);
    assert.deepEqual(stops, ["tab", view === "threads" ? "as-scroller" : "as-scroller as-managers"], "the chosen tab, then the shown list");
    cleanup();
  }
});

test("a first manager started, or the last archived, never remounts the threads' list: its focus and scroll stay", async () => {
  const { show, threads } = mount({ managers: [], view: "threads" });
  const list = threads();
  assert.ok(list);
  list.focus();
  list.scrollTop = 128;

  await show({ managers: [PR], view: "threads" });
  assert.equal(threads(), list, "the same list, not a new one");
  assert.equal(document.activeElement, list);
  assert.equal(list.scrollTop, 128);

  await show({ managers: [], view: "threads" });
  assert.equal(threads(), list);
  assert.equal(document.activeElement, list);
  assert.equal(list.scrollTop, 128);
});

test("the first manager started with Managers chosen, while the reader works in the threads' list: the threads stay, and so does focus", async () => {
  const { slot, show, threads } = mount({ managers: [], view: "managers" });
  const list = threads();
  assert.ok(list);
  list.focus();

  await show({ managers: [PR], view: "managers" });
  assert.equal(list.closest("[hidden]"), null, "the threads' list still shows");
  assert.equal(document.activeElement, list);
  assert.equal(slot.getByRole("tab", { selected: true }).textContent, "Threads");

  act(() => slot.getByRole("tab", { name: "Managers" }).click());
  assert.ok(list.closest("[hidden]"), "picking Managers shows them");
});

test("the first manager started while the threads' view menu is open: the menu stays open over the threads, its focus kept", async () => {
  const projects = [project("prj_a", "bb-plugins")];
  const menu = createElement(ViewMenu, { projects, chosen: null, onChoose: () => {}, compact: true, onCompact: () => {} });
  const withMenu = createElement("div", { className: "as-scroller", tabIndex: 0, "data-threads": "" }, menu);
  const at = (managers: readonly ManagerModel[]) => ({ ...props({ managers, view: "managers" }), threads: withMenu });
  const slot = renderSlot({ component: SidebarViews }, at([]));
  await act(async () => fireEvent.keyDown(slot.getByRole("button", { name: "View options" }), { key: "Enter" }));
  const compact = await slot.findByRole("menuitemcheckbox");
  act(() => compact.focus());
  assert.equal(document.activeElement, compact);

  await act(async () => slot.lifecycle.rerender(createElement(SidebarViews, at([PR]))));
  assert.ok(compact.isConnected, "the menu is still open");
  assert.equal(document.activeElement, compact);
  assert.equal(slot.container.querySelector("[data-threads]")?.closest("[hidden]"), null, "over the threads, still shown");
});

test("the first manager started while focus is outside the sidebar: the chosen Managers view shows", async () => {
  const { slot, show } = mount({ managers: [], view: "managers" });
  await show({ managers: [PR], view: "managers" });
  assert.equal(slot.getByRole("tab", { selected: true }).textContent, "Managers");
  assert.equal(slot.container.querySelector("[data-threads]")?.closest("[hidden]") !== null, true);
});

test("a tab clicked where the browser doesn't focus buttons (Safari) takes focus from the panel it hides", () => {
  let view: View = "threads";
  const slot = renderSlot({ component: SidebarViews }, { ...props({ managers: [PR], view }), onView: (next: View) => (view = next) });
  slot.container.querySelector<HTMLElement>("[data-threads]")?.focus();
  // why: fireEvent.click dispatches the click alone, without the focus a click gives a button elsewhere.
  fireEvent.click(slot.getByRole("tab", { name: "Managers" }));
  assert.equal(view, "managers");
  assert.equal(document.activeElement, slot.getByRole("tab", { name: "Managers" }));
});

test("Threads → Managers → Threads brings back the same threads' list, scrolled where it was left", async () => {
  const { slot, show, threads } = mount({ managers: [PR], view: "threads" });
  const list = threads();
  assert.ok(list);
  list.scrollTop = 128;

  await show({ managers: [PR], view: "managers" });
  assert.equal(slot.getByRole("tab", { selected: true }).textContent, "Managers");
  await show({ managers: [PR], view: "threads" });
  assert.equal(threads(), list, "the same list, not a new one");
  assert.equal(list.closest("[hidden]"), null);
  assert.equal(list.scrollTop, 128);
});

test("the last manager archived while focus is on the segment or a manager's row: focus passes to the threads' list", async () => {
  for (const focusOn of ["tab", "row"] as const) {
    const { slot, show, threads } = mount({ managers: [PR], view: "managers" });
    const target = focusOn === "tab" ? slot.getByRole("tab", { name: "Managers" }) : slot.getByRole("link", { name: "PR Reviews" });
    target.focus();
    assert.equal(document.activeElement, target);

    await show({ managers: [], view: "managers" });
    assert.equal(document.activeElement, threads(), focusOn);
    cleanup();
  }
});

test("a focused manager archived while others remain: focus passes to the next one, or the one before the last", async () => {
  const { slot, show } = mount({ managers: [PR, SIDEBAR], view: "managers" });
  slot.getByRole("link", { name: "PR Reviews" }).focus();

  await show({ managers: [SIDEBAR], view: "managers" });
  assert.equal(document.activeElement, slot.getByRole("link", { name: "Sidebar" }));

  const third = manager("Docs", 3);
  await show({ managers: [SIDEBAR, third], view: "managers" });
  slot.getByRole("link", { name: "Docs" }).focus();
  await show({ managers: [SIDEBAR], view: "managers" });
  assert.equal(document.activeElement, slot.getByRole("link", { name: "Sidebar" }));
});

test("focus outside the sidebar stays where it is when the last manager goes", async () => {
  const { show } = mount({ managers: [PR], view: "managers" });
  const elsewhere = document.body.appendChild(document.createElement("button"));
  elsewhere.focus();

  await show({ managers: [], view: "managers" });
  assert.equal(document.activeElement, elsewhere);
  elsewhere.remove();
});

test("a manager's row shows its name over its line, read out after its name; with no line, its name alone", () => {
  const { slot } = mount({ managers: [{ ...PR, line: "Two pull requests wait on you." }, SIDEBAR], view: "managers" });
  const [withLine, bare] = slot.container.querySelectorAll<HTMLElement>(".as-manager");
  assert.deepEqual(
    [withLine, bare].map((row) => Array.from(row.querySelectorAll(".as-title-text"), (text) => text.textContent)),
    [["PR Reviews", "Two pull requests wait on you."], ["Sidebar"]],
  );
  assert.equal(withLine.querySelector(".as-manager-line")?.textContent, "Two pull requests wait on you.");
  assert.equal(bare.querySelector(".as-manager-line"), null);
  assert.ok(slot.getByRole("link", { name: "PR Reviews, Two pull requests wait on you." }));
});

// ------------------------------------------------------------------ pinned managers

const tiles = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".as-pin"), (tile) => tile.getAttribute("aria-label"));
const rows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".as-manager"), (row) => row.querySelector(".as-title-text")?.textContent);

test("pinned managers stand as tiles in a Pinned group above the rows, each its avatar and its name, and leave the rows", () => {
  const docs = manager("Docs", 3);
  const { slot } = mount({ pinned: [docs, PR], managers: [SIDEBAR], view: "managers" });
  const grid = slot.getByRole("group", { name: "Pinned" });
  assert.deepEqual(tiles(grid), ["Docs", "PR Reviews"], "in the order given: bb's pin order");
  assert.deepEqual(rows(slot.container), ["Sidebar"]);
  const [first] = grid.querySelectorAll(".as-pin");
  assert.deepEqual([first.querySelector(".as-avatar") !== null, first.querySelector(".as-pin-name")?.textContent], [true, "Docs"]);
  const row = slot.container.querySelector(".as-manager");
  assert.ok(row && grid.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING, "the grid comes first");
});

test("the open manager's tile is the current page; with nothing pinned there is no grid", async () => {
  const { slot, show } = mount({ pinned: [{ ...PR, current: true }], managers: [SIDEBAR], view: "managers" });
  assert.equal(slot.getByRole("link", { name: "PR Reviews" }).getAttribute("aria-current"), "page");

  await show({ managers: [PR, SIDEBAR], view: "managers" });
  assert.equal(slot.queryByRole("group", { name: "Pinned" }), null);
  assert.deepEqual(rows(slot.container), ["PR Reviews", "Sidebar"]);
});

test("a focused manager pinned or unpinned (from its menu): focus follows it between its row and its tile", async () => {
  const { slot, show } = mount({ managers: [PR, SIDEBAR], view: "managers" });
  slot.getByRole("link", { name: "PR Reviews" }).focus();

  await show({ pinned: [PR], managers: [SIDEBAR], view: "managers" });
  assert.equal(document.activeElement, slot.container.querySelector(".as-pin"));

  await show({ managers: [PR, SIDEBAR], view: "managers" });
  assert.equal(document.activeElement, slot.getByRole("link", { name: "PR Reviews" }));
});

import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup } from "@testing-library/react";
import { createElement } from "react";
import type { View } from "../../data/local-choice/choices.ts";
import type { ManagerModel } from "../../model/activity.ts";
import { thread } from "../../model/fixtures.ts";

// The sidebar around the threads' list, mounted as bb mounts it. The threads' list stands in as its
// scroller: its own tests are list/items.test.ts and model/activity.test.ts.

const { SidebarViews } = await import("./sidebar-views.tsx");

afterEach(cleanup);

const THREADS = createElement("div", { className: "as-scroller", tabIndex: 0, "data-threads": "" });

const manager = (id: string, createdAt: number): ManagerModel => ({
  thread: thread(id, { originPluginId: "regional-manager", createdAt, displayTitle: id }),
  avatar: null,
  description: null,
  current: false,
});
const PR = manager("PR Reviews", 1);
const SIDEBAR = manager("Sidebar", 2);

type Shown = { managers: readonly ManagerModel[]; view: View };
const props = ({ managers, view }: Shown) => ({ managers, view, onView: () => {}, onNavigate: () => {}, threads: THREADS });

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

test("the first manager started with Managers chosen, while the threads' list held focus: focus passes to the managers' list", async () => {
  const { slot, show, threads } = mount({ managers: [], view: "managers" });
  threads()?.focus();
  assert.equal(document.activeElement, threads());

  await show({ managers: [PR], view: "managers" });
  assert.ok(threads()?.closest("[hidden]"), "Managers is shown, the threads' list hidden");
  assert.equal(document.activeElement, slot.container.querySelector(".as-managers"));
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

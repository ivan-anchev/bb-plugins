import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { DWELL } from "../../card/card-intent.ts";
import type { View } from "../../data/local-choice/choices.ts";
import { view as listView, quiet } from "../../list/fixtures.ts";
import { listItems } from "../../list/items.ts";
import { buildActivity } from "../../model/activity.ts";
import { project, thread } from "../../model/fixtures.ts";
import { installHostThreadMenu, PageResizeObserver } from "../../test-host.ts";

// Where the threads' options sit: on Activity's title with no managers, in the control row with them.
// A panel hidden takes every overlay it opened with it: the threads' hover card, view menu and a row's
// thread menu; a manager's hover card and its row's thread menu. Shown again, the threads' list comes
// back whole. Mounted as bb mounts the sidebar, with the real list.

const { SidebarViews } = await import("./sidebar-views.tsx");
const { ListViewport } = await import("../list-viewport.tsx");
const { ViewMenu } = await import("../view-menu/view-menu.tsx");

before(() => {
  // why: jsdom lays nothing out, so the list would see no height and mount no row. A hidden panel measures 0, as in a browser.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest("[hidden]") === null ? 600 : 0;
    },
  });
  globalThis.ResizeObserver = PageResizeObserver;
  installHostThreadMenu();
});
afterEach(cleanup);

const PROJECTS = [project("prj_a", "bb-plugins")];
const THREADS = [
  thread("thr_mgr", { originPluginId: "regional-manager", createdAt: 1, displayTitle: "PR Reviews", projectId: "prj_a" }),
  thread("thr_a", { displayTitle: "Fix the build", latestAttentionAt: 20, projectId: "prj_a" }),
  thread("thr_b", { displayTitle: "Write the docs", latestAttentionAt: 10, projectId: "prj_a" }),
];

const OPTIONS = {
  threads: createElement(ViewMenu, { view: "threads", projects: PROJECTS, chosen: null, onChoose: () => {}, compact: true, onCompact: () => {} }),
  managers: createElement(ViewMenu, { view: "managers", projects: [], chosen: null, onChoose: () => {}, compact: false, onCompact: () => {} }),
};

/** The sidebar as bb mounts it over `threads`, with the real threads' list, showing `view`. */
function sidebarProps(threads: readonly PluginSidebarThread[], view: View) {
  const model = buildActivity({ threads, projects: PROJECTS, sleeps: new Map(), held: new Set(), now: 100, activeThreadId: null, filter: null, looks: [], lines: [] });
  const list = (viewMenu: ReactNode) =>
    createElement(ListViewport, {
      items: listItems(model.sections, listView()),
      card: { index: model.index, underWaySince: new Map() },
      onNavigate: () => {},
      sleep: { sleep: () => {}, wake: () => {} },
      onToggle: () => {},
      onShowMoreArchived: () => {},
      onRetry: () => {},
      viewMenu,
    });
  return { managers: model.managers, managersCompact: false, underWaySince: new Map<string, number>(), view, onView: () => {}, onNavigate: () => {}, options: OPTIONS, threads: list };
}

function mount(view: View, threads: readonly PluginSidebarThread[] = THREADS) {
  const props = (shown: View) => sidebarProps(threads, shown);
  const slot = renderSlot({ component: SidebarViews }, props(view));
  const choose = async (shown: View) => {
    await act(async () => {
      // why: by its id, not its role: an open menu hides everything else from the accessibility tree, as in bb.
      fireEvent.click(tab(shown));
      slot.lifecycle.rerender(createElement(SidebarViews, props(shown)));
    });
    await act(() => wait(0));
  };
  const tab = (of: View) => {
    const found = slot.container.querySelector<HTMLElement>(`[role=tab][id$="-${of}-tab"]`);
    assert.ok(found);
    return found;
  };
  const link = (name: string) => slot.getByRole("link", { name: new RegExp(`^${name}`) });
  return { slot, choose, link, tab };
}

const menus = () => document.querySelectorAll("[role=menu]").length;
const overlays = () => document.querySelectorAll("[data-bb-portaled-overlay], [role=menu], [role=dialog]").length;

test("the threads' hover card, open on its row, goes as Managers is chosen, and focus lands on the chosen tab", async () => {
  const { choose, link, tab } = mount("threads");
  act(() => link("Fix the build").focus());
  await act(() => wait(DWELL + 50));
  assert.ok(document.querySelector(".as-card"), "its card shows");

  await choose("managers");
  assert.equal(document.querySelector(".as-card"), null, "no card over Managers");
  assert.equal(overlays(), 0);
  assert.equal(document.activeElement, tab("managers"));
});

test("a thread row's menu, or the threads' view menu, open as Managers is chosen: it closes, and focus leaves the hidden list", async () => {
  for (const open of ["row menu", "view menu"] as const) {
    const { slot, choose, link } = mount("threads");
    if (open === "row menu") await act(async () => fireEvent.contextMenu(link("Fix the build")));
    else await act(async () => fireEvent.keyDown(slot.getByRole("button", { name: "Threads options" }), { key: "Enter" }));
    assert.equal(menus(), 1, `${open} open`);

    await choose("managers");
    assert.equal(menus(), 0, `${open} gone from the page`);
    assert.equal(document.activeElement?.closest(".as-panel[hidden]") ?? null, null, "no focus in the hidden panel");

    await choose("threads");
    assert.equal(menus(), 0, `${open} still closed back on Threads`);
    cleanup();
  }
});

test("a manager's hover card, open on its row, goes as Threads is chosen, and focus lands on the chosen tab", async () => {
  const { choose, link, tab } = mount("managers");
  act(() => link("PR Reviews").focus());
  await act(() => wait(DWELL + 50));
  assert.ok(document.querySelector(".as-card"), "its card shows");

  await choose("threads");
  assert.equal(document.querySelector(".as-card"), null, "no card over Threads");
  assert.equal(overlays(), 0);
  assert.equal(document.activeElement, tab("threads"));
});

test("a manager row's menu, open as Threads is chosen, closes, and stays closed back on Managers", async () => {
  const { choose, link } = mount("managers");
  await act(async () => fireEvent.contextMenu(link("PR Reviews")));
  assert.equal(menus(), 1, "its menu open");

  await choose("threads");
  assert.equal(menus(), 0, "gone from the page");
  assert.equal(document.activeElement?.closest(".as-panel[hidden]") ?? null, null, "no focus in the hidden panel");

  await choose("managers");
  assert.equal(menus(), 0, "still closed");
});

test("the threads' list, shown again after Managers, lays out whole on its first frame: Archived stands at its foot", async () => {
  const { choose } = mount("threads", [THREADS[0], ...quiet(8)]);
  const archived = () => document.querySelector('[data-key="t:archived"]');
  assert.ok(archived(), "Archived at the foot");

  await choose("managers");
  await act(() => PageResizeObserver.deliver());
  await choose("threads");
  assert.ok(archived(), "Archived there before the page tells the list its size again");
});

// ------------------------------------------------------------------ where the threads' options sit

const NO_MANAGER = THREADS.slice(1);
/** The section title holding the threads' options button, by its heading's name; null in none. */
const titleHolding = (button: HTMLElement) => button.closest(".as-section-title")?.querySelector(".as-fold-name")?.textContent ?? null;
const threadsOptions = () => {
  const button = document.querySelector<HTMLElement>('[aria-label^="Threads options"]');
  assert.ok(button, "the threads' options button");
  return button;
};

test("with no managers, the threads' options sit on Activity's title; with them, in the control row, and on no title", async () => {
  const slot = renderSlot({ component: SidebarViews }, sidebarProps(NO_MANAGER, "threads"));
  assert.equal(slot.container.querySelector(".as-controls"), null, "no control row");
  assert.equal(titleHolding(threadsOptions()), "Activity");

  await act(async () => slot.lifecycle.rerender(createElement(SidebarViews, sidebarProps(THREADS, "threads"))));
  assert.equal(titleHolding(threadsOptions()), null);
  assert.ok(threadsOptions().closest(".as-controls"));
});

test("the first manager started while the reader is in the threads' list, its menu closed: the options join the row at once", async () => {
  const slot = renderSlot({ component: SidebarViews }, sidebarProps(NO_MANAGER, "managers"));
  const list = slot.container.querySelector<HTMLElement>(".as-scroller");
  assert.ok(list);
  act(() => list.focus());

  await act(async () => slot.lifecycle.rerender(createElement(SidebarViews, sidebarProps(THREADS, "managers"))));
  assert.ok(threadsOptions().closest(".as-controls"), "in the row");
  assert.equal(titleHolding(threadsOptions()), null, "not on Activity's title");
  assert.equal(document.activeElement, list, "focus stays in the threads' list, still shown");
  assert.equal(list.closest("[hidden]"), null);
});

test("the first manager started while the threads' menu is open: it stays open on the title, then its button joins the row as it closes, with focus", async () => {
  const slot = renderSlot({ component: SidebarViews }, sidebarProps(NO_MANAGER, "threads"));
  await act(async () => fireEvent.keyDown(threadsOptions(), { key: "Enter" }));
  const compact = await slot.findByRole("menuitemcheckbox");
  act(() => compact.focus());

  await act(async () => slot.lifecycle.rerender(createElement(SidebarViews, sidebarProps(THREADS, "threads"))));
  assert.ok(compact.isConnected, "the menu is still open");
  assert.equal(titleHolding(threadsOptions()), "Activity");

  await act(async () => fireEvent.keyDown(compact, { key: "Escape" }));
  await act(() => wait(0));
  assert.equal(menus(), 0, "closed");
  assert.ok(threadsOptions().closest(".as-controls"), "in the row");
  assert.equal(document.activeElement, threadsOptions(), "focus on its button there");
});

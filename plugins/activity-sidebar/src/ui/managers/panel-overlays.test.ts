import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { DWELL } from "../../card/card-intent.ts";
import type { View } from "../../data/local-choice/choices.ts";
import { view as listView, quiet } from "../../list/fixtures.ts";
import { listItems } from "../../list/items.ts";
import { buildActivity } from "../../model/activity.ts";
import { project, thread } from "../../model/fixtures.ts";
import { installHostThreadMenu, PageResizeObserver } from "../../test-host.ts";

// A panel hidden takes every overlay it opened with it: the threads' hover card, view menu and a row's
// thread menu; a manager's hover card and its row's thread menu. Shown again, the threads' list comes
// back whole. Mounted as bb mounts the sidebar, with the real list.

const { SidebarViews } = await import("./sidebar-views.tsx");
const { ListViewport } = await import("../list-viewport.tsx");
const { ViewMenu } = await import("../view-menu.tsx");

before(() => {
  // why: jsdom lays nothing out, so the list would see no height and mount no row. A hidden panel's measure 0, as in a browser.
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

function mount(view: View, threads: readonly PluginSidebarThread[] = THREADS) {
  const model = buildActivity({ threads, projects: PROJECTS, sleeps: new Map(), held: new Set(), now: 100, activeThreadId: null, filter: null, looks: [], lines: [] });
  const list = createElement(ListViewport, {
    items: listItems(model.sections, listView()),
    card: { index: model.index, underWaySince: new Map() },
    onNavigate: () => {},
    sleep: { sleep: () => {}, wake: () => {} },
    onToggle: () => {},
    onShowMoreArchived: () => {},
    onRetry: () => {},
    viewMenu: createElement(ViewMenu, { projects: PROJECTS, chosen: null, onChoose: () => {}, compact: true, onCompact: () => {} }),
  });
  const props = (shown: View) => ({ managers: model.managers, underWaySince: new Map<string, number>(), view: shown, onView: () => {}, onNavigate: () => {}, threads: list });
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
    else await act(async () => fireEvent.keyDown(slot.getByRole("button", { name: "View options" }), { key: "Enter" }));
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

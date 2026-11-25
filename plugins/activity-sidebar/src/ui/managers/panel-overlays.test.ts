import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { DWELL } from "../../card/card-intent.ts";
import type { View } from "../../data/local-choice/choices.ts";
import { view as listView } from "../../list/fixtures.ts";
import { listItems } from "../../list/items.ts";
import { buildActivity } from "../../model/activity.ts";
import { project, thread } from "../../model/fixtures.ts";

// A panel hidden takes every overlay it opened with it: the threads' hover card, view menu and a row's
// thread menu; a manager row's thread menu. Mounted as bb mounts the sidebar, with the real list.

const { SidebarViews } = await import("./sidebar-views.tsx");
const { ListViewport } = await import("../list-viewport.tsx");
const { ViewMenu } = await import("../view-menu.tsx");

// why: jsdom lays nothing out, so the list would see no height and mount no row.
before(() => Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 }));
afterEach(cleanup);

const PROJECTS = [project("prj_a", "bb-plugins")];
const THREADS = [
  thread("thr_mgr", { originPluginId: "regional-manager", createdAt: 1, displayTitle: "PR Reviews", projectId: "prj_a" }),
  thread("thr_a", { displayTitle: "Fix the build", latestAttentionAt: 20, projectId: "prj_a" }),
  thread("thr_b", { displayTitle: "Write the docs", latestAttentionAt: 10, projectId: "prj_a" }),
];

function mount(view: View) {
  const model = buildActivity({ threads: THREADS, projects: PROJECTS, sleeps: new Map(), held: new Set(), now: 100, activeThreadId: null, filter: null, looks: [], lines: [] });
  const threads = createElement(ListViewport, {
    items: listItems(model.sections, listView()),
    card: { index: model.index, underWaySince: new Map() },
    onNavigate: () => {},
    sleep: { sleep: () => {}, wake: () => {} },
    onToggle: () => {},
    onShowMoreArchived: () => {},
    onRetry: () => {},
    viewMenu: createElement(ViewMenu, { projects: PROJECTS, chosen: null, onChoose: () => {}, compact: true, onCompact: () => {} }),
  });
  const props = (shown: View) => ({ managers: model.managers, view: shown, onView: () => {}, onNavigate: () => {}, threads });
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
    assert.ok(await slot.findByRole("menu"), `${open} open`);

    await choose("managers");
    assert.equal(slot.queryByRole("menu"), null, `${open} closed`);
    assert.equal(document.activeElement?.closest(".as-panel[hidden]") ?? null, null, "no focus in the hidden panel");
    cleanup();
  }
});

test("a manager row's menu, open as Threads is chosen, closes", async () => {
  const { slot, choose, link } = mount("managers");
  await act(async () => fireEvent.contextMenu(link("PR Reviews")));
  assert.ok(await slot.findByRole("menu"));

  await choose("threads");
  assert.equal(slot.queryByRole("menu"), null);
  assert.equal(document.activeElement?.closest(".as-panel[hidden]") ?? null, null);
});

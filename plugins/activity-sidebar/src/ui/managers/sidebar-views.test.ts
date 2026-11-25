import "../../test-tsx.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { View } from "../../data/local-choice/choices.ts";
import type { ManagerModel } from "../../model/activity.ts";
import { thread } from "../../model/fixtures.ts";

// What the sidebar shows around the threads' list, rendered as bb renders it. The threads' list
// stands in as a marker: its own tests are list/items.test.ts and model/activity.test.ts.

const { SidebarViews } = await import("./sidebar-views.tsx");

const THREADS = createElement("div", { "data-threads": "" });
const MANAGER: ManagerModel = { thread: thread("thr_pr", { originPluginId: "regional-manager" }), avatar: null, description: null, current: false };

function render(managers: readonly ManagerModel[], view: View): string {
  return renderToStaticMarkup(createElement(SidebarViews, { managers, view, onView: () => {}, onNavigate: () => {}, threads: THREADS }));
}

test("with no regional managers there is no segment: the sidebar is the threads' list alone, as before managers", () => {
  for (const view of ["threads", "managers"] as const) assert.equal(render([], view), renderToStaticMarkup(THREADS), view);
});

test("with managers, the Managers | Threads segment stands over the chosen view", () => {
  const html = render([MANAGER], "threads");
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab"[^>]*aria-selected="false"[^>]*>Managers</);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Threads</);
  assert.match(html, /role="tabpanel"[^>]*><div data-threads=""><\/div><\/div>/);
});

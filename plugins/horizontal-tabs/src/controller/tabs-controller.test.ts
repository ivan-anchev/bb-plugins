import assert from "node:assert/strict";
import { test } from "node:test";
import { single, type Layout } from "../model/layout.ts";
import { createTabsController, type HostLayout } from "./tabs-controller.ts";

/** bb's layout as the test sets it. */
function fakeHost(initial: Layout | null): HostLayout & { layout: Layout | null } {
  return {
    layout: initial,
    read() {
      return this.layout;
    },
  };
}

const alpha = single({ kind: "thread", projectId: "proj_a", threadId: "thr_alpha" }, "pane-1");
const bravo = single({ kind: "thread", projectId: "proj_a", threadId: "thr_bravo" }, "pane-1");
const newThread = single({ kind: "new-thread" }, "pane-1");
const pluginPage = single({ kind: "plugin-panel", pluginId: "notes", panelPath: "notes", subPath: "" }, "pane-1");

function liveLayout(tabs: ReturnType<typeof createTabsController>): Layout | undefined {
  const snapshot = tabs.snapshot();
  return snapshot?.set.tabs.find((tab) => tab.id === snapshot.set.liveId)?.layout;
}

test("has no snapshot before bb is first observed", () => {
  assert.equal(createTabsController(fakeHost(alpha)).snapshot(), null);
});

test("the first observe seeds one selected tab with bb's layout", () => {
  const tabs = createTabsController(fakeHost(alpha));
  tabs.observe("thr_alpha");
  const snapshot = tabs.snapshot()!;
  assert.equal(snapshot.set.tabs.length, 1);
  assert.deepEqual(liveLayout(tabs), alpha);
  assert.equal(snapshot.selectedId, snapshot.set.liveId);
});

test("seeds a New thread tab when bb holds no layout yet", () => {
  const tabs = createTabsController(fakeHost(null));
  tabs.observe(null);
  assert.deepEqual(liveLayout(tabs), newThread);
  assert.equal(tabs.snapshot()!.selectedId, null);
});

test("adopts bb's layout while its focused pane shows a thread", () => {
  const host = fakeHost(alpha);
  const tabs = createTabsController(host);
  tabs.observe("thr_alpha");
  host.layout = bravo;
  tabs.observe("thr_bravo");
  assert.deepEqual(liveLayout(tabs), bravo);
});

test("keeps the tab's layout and selects no tab on bb's New thread and plugin pages", () => {
  const host = fakeHost(alpha);
  const tabs = createTabsController(host);
  tabs.observe("thr_alpha");
  for (const layout of [newThread, pluginPage]) {
    host.layout = layout;
    tabs.observe(null);
    assert.deepEqual(liveLayout(tabs), alpha);
    assert.equal(tabs.snapshot()!.selectedId, null);
  }
});

test("selects no tab off thread routes such as Settings, and the tab again on a thread", () => {
  const tabs = createTabsController(fakeHost(alpha));
  tabs.observe("thr_alpha");
  const { liveId } = tabs.snapshot()!.set;
  tabs.observe(null);
  assert.equal(tabs.snapshot()!.selectedId, null);
  tabs.observe("thr_alpha");
  assert.equal(tabs.snapshot()!.selectedId, liveId);
});

test("notifies subscribers on every change, and stops after unsubscribing", () => {
  const tabs = createTabsController(fakeHost(alpha));
  let calls = 0;
  const unsubscribe = tabs.subscribe(() => (calls += 1));
  tabs.observe("thr_alpha");
  tabs.syncThreads({ status: "ready", threads: [], projects: [], sections: [], experimental_archived: null });
  unsubscribe();
  tabs.observe("thr_alpha");
  assert.equal(calls, 2);
});

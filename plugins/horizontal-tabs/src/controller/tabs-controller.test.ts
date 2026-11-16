import assert from "node:assert/strict";
import { test } from "node:test";
import { focused, panes, single, type Layout } from "../model/layout.ts";
import { createTabsController, type HostLayout, type Nav } from "./tabs-controller.ts";

/**
 * bb as the test drives it: `layout` is what bb holds, and each write stays in flight until `settle`, `fail`,
 * or its signal aborts.
 */
type FakeHost = HostLayout & {
  layout: Layout | null;
  /** Every layout written, in order. */
  shown: Layout[];
  /** bb finishes the write in flight. */
  settle(): Promise<void>;
  /** The write in flight fails. */
  fail(error: Error): Promise<void>;
};

function fakeHost(initial: Layout | null): FakeHost {
  const writes: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const host: FakeHost = {
    layout: initial,
    shown: [],
    read: () => host.layout,
    show(layout, _nav, signal) {
      host.shown.push(layout);
      host.layout = layout;
      return new Promise<void>((resolve, reject) => {
        writes.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    },
    async settle() {
      writes.shift()?.resolve();
      await flush();
    },
    async fail(error) {
      writes.shift()?.reject(error);
      await flush();
    },
  };
  return host;
}

const nav: Nav = { toThread() {}, toCompose() {} };

/** Lets the controller's pump run past its awaits. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function thread(threadId: string, paneId = "pane-1"): Layout {
  return single({ kind: "thread", projectId: "proj_a", threadId }, paneId);
}

const alpha = thread("thr_alpha");
const newThread = single({ kind: "new-thread" }, "pane-1");
const pluginPage = single({ kind: "plugin-panel", pluginId: "notes", panelPath: "notes", subPath: "" }, "pane-1");

function controller(initial: Layout | null) {
  const host = fakeHost(initial);
  const tabs = createTabsController(host);
  const unbind = tabs.bind(nav);
  return { host, tabs, unbind };
}

function snapshotOf(tabs: ReturnType<typeof createTabsController>) {
  const snapshot = tabs.snapshot();
  assert.ok(snapshot);
  return snapshot;
}

function liveLayout(tabs: ReturnType<typeof createTabsController>): Layout {
  const { set } = snapshotOf(tabs);
  const live = set.tabs.find((tab) => tab.id === set.liveId);
  assert.ok(live);
  return live.layout;
}

function focusedThread(layout: Layout | undefined): string | null {
  assert.ok(layout);
  const content = focused(layout).content;
  return content.kind === "thread" ? content.threadId : null;
}

/** Three tabs on Alpha, Bravo and Charlie, each filled from `+` the way bb fills it; Charlie's is live. */
async function threeTabs() {
  const { host, tabs, unbind } = controller(alpha);
  tabs.observe("thread");
  for (const threadId of ["thr_bravo", "thr_charlie"]) {
    tabs.openNew();
    await host.settle();
    host.layout = thread(threadId, liveLayout(tabs).focusedPaneId);
    tabs.observe("thread");
  }
  const ids = snapshotOf(tabs).set.tabs.map((tab) => tab.id);
  host.shown.length = 0;
  return { host, tabs, ids, unbind };
}

test("has no snapshot before bb is first observed", () => {
  assert.equal(controller(alpha).tabs.snapshot(), null);
});

test("the first observe seeds one selected tab with bb's layout", () => {
  const { tabs } = controller(alpha);
  tabs.observe("thread");
  const snapshot = snapshotOf(tabs);
  assert.equal(snapshot.set.tabs.length, 1);
  assert.deepEqual(liveLayout(tabs), alpha);
  assert.equal(snapshot.selectedId, snapshot.set.liveId);
});

test("seeds a New thread tab when bb holds no layout yet", () => {
  const { tabs } = controller(null);
  tabs.observe("workspace");
  assert.deepEqual(liveLayout(tabs), newThread);
  assert.equal(snapshotOf(tabs).selectedId, null);
});

test("adopts bb's layout while its focused pane shows a thread", () => {
  const { host, tabs } = controller(alpha);
  tabs.observe("thread");
  host.layout = thread("thr_bravo");
  tabs.observe("thread");
  assert.deepEqual(liveLayout(tabs), thread("thr_bravo"));
});

test("keeps the tab's layout and selects no tab on bb's New thread and plugin pages", () => {
  const { host, tabs } = controller(alpha);
  tabs.observe("thread");
  for (const layout of [newThread, pluginPage]) {
    host.layout = layout;
    tabs.observe("workspace");
    assert.deepEqual(liveLayout(tabs), alpha);
    assert.equal(snapshotOf(tabs).selectedId, null);
  }
});

test("selects no tab off thread routes such as Settings, and the tab again on a thread", () => {
  const { tabs } = controller(alpha);
  tabs.observe("thread");
  const { liveId } = snapshotOf(tabs).set;
  tabs.observe("page");
  assert.equal(snapshotOf(tabs).selectedId, null);
  tabs.observe("thread");
  assert.equal(snapshotOf(tabs).selectedId, liveId);
});

test("notifies subscribers on every change, and stops after unsubscribing", () => {
  const { tabs } = controller(alpha);
  let calls = 0;
  const unsubscribe = tabs.subscribe(() => (calls += 1));
  tabs.observe("thread");
  tabs.syncThreads({ status: "ready", threads: [], projects: [], sections: [], experimental_archived: null });
  unsubscribe();
  tabs.observe("thread");
  assert.equal(calls, 2);
});

test("+ opens a selected New thread tab right of the live one, and shows it", async () => {
  const { host, tabs } = controller(alpha);
  tabs.observe("thread");
  const first = snapshotOf(tabs).set.liveId;
  tabs.openNew();
  const { set, selectedId } = snapshotOf(tabs);
  assert.deepEqual(set.tabs.map((tab) => tab.id), [first, set.liveId]);
  assert.equal(selectedId, set.liveId);
  assert.equal(focused(host.shown[0]).content.kind, "new-thread");
  await host.settle();
  // bb's New thread screen keeps the + tab selected though the route has no thread.
  tabs.observe("workspace");
  assert.equal(snapshotOf(tabs).selectedId, set.liveId);
});

test("the thread created on a + tab's New thread screen fills that tab", async () => {
  const { host, tabs } = controller(alpha);
  tabs.observe("thread");
  tabs.openNew();
  await host.settle();
  const paneId = liveLayout(tabs).focusedPaneId;
  host.layout = thread("thr_bravo", paneId);
  tabs.observe("thread");
  assert.deepEqual(liveLayout(tabs), thread("thr_bravo", paneId));
  assert.deepEqual(snapshotOf(tabs).set.tabs[0].layout, alpha);
});

test("clicking a tab shows its layout with pane ids apart from the outgoing layout's, and selects it", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.activate(ids[0]);
  await host.settle();
  const shown = host.shown[0];
  assert.equal(focusedThread(shown), "thr_alpha");
  assert.equal(snapshotOf(tabs).selectedId, ids[0]);
  assert.deepEqual(liveLayout(tabs), shown);
  const outgoing = new Set(panes(snapshotOf(tabs).set.tabs[2].layout).map((pane) => pane.paneId));
  assert.ok(panes(shown).every((pane) => !outgoing.has(pane.paneId)));
});

test("three quick tab clicks write bb's layout at most twice, and the last click wins", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.activate(ids[0]);
  tabs.activate(ids[1]);
  tabs.activate(ids[2]);
  await host.settle();
  await host.settle();
  assert.ok(host.shown.length <= 2, `${host.shown.length} writes`);
  assert.equal(focusedThread(host.shown.at(-1)), "thr_charlie");
  assert.equal(snapshotOf(tabs).set.liveId, ids[2]);
  assert.equal(snapshotOf(tabs).selectedId, ids[2]);
});

test("a change bb reports while a write is in flight is not adopted", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.activate(ids[0]);
  const target = liveLayout(tabs);
  host.layout = thread("thr_delta");
  tabs.observe("thread");
  assert.deepEqual(liveLayout(tabs), target);
});

test("once the write settles, the live tab is what bb shows", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.activate(ids[0]);
  host.layout = thread("thr_delta", "pane-9");
  await host.settle();
  assert.deepEqual(liveLayout(tabs), host.read());
});

test("a failed write is reported once, and the tab takes what bb shows", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const { host, tabs, ids } = await threeTabs();
  const before = host.read();
  tabs.activate(ids[0]);
  host.layout = before;
  await host.fail(new Error("no atom"));
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(liveLayout(tabs), before);
});

test("clicking the live tab from Settings shows its layout again with its own pane ids", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.observe("page");
  tabs.activate(ids[2]);
  await host.settle();
  assert.deepEqual(host.shown, [liveLayout(tabs)]);
  assert.equal(host.shown[0].focusedPaneId, `${ids[2]}-1`);
});

test("from Settings or a plugin page, clicking the + tab shows its New thread screen again", async () => {
  for (const [screen, layout] of [["page", null], ["workspace", pluginPage]] as const) {
    const { host, tabs } = controller(alpha);
    tabs.observe("thread");
    tabs.openNew();
    await host.settle();
    const plusTab = liveLayout(tabs);
    // Settings leaves bb's layout as it was; a plugin page fills the + tab's pane.
    host.layout = layout ?? plusTab;
    tabs.observe(screen);
    assert.equal(snapshotOf(tabs).selectedId, null, screen);
    tabs.activate(snapshotOf(tabs).set.liveId);
    assert.deepEqual(host.shown.at(-1), plusTab, screen);
    assert.equal(snapshotOf(tabs).selectedId, snapshotOf(tabs).set.liveId, screen);
  }
});

test("unbinding aborts the write in flight, and nothing more is written or reported", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const { host, tabs, ids, unbind } = await threeTabs();
  tabs.activate(ids[0]);
  tabs.activate(ids[1]);
  let changes = 0;
  tabs.subscribe(() => (changes += 1));
  unbind();
  // bb finishing the aborted write must not let the waiting switch through.
  await host.settle();
  assert.equal(host.shown.length, 1);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(changes, 0);
});

test("clicking the selected tab writes nothing", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.activate(ids[2]);
  assert.equal(host.shown.length, 0);
});

test("closing the live tab shows its right neighbour, else its left", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.activate(ids[1]);
  await host.settle();
  tabs.close(ids[1]);
  await host.settle();
  assert.equal(snapshotOf(tabs).set.liveId, ids[2]);
  assert.equal(focusedThread(host.shown.at(-1)), "thr_charlie");
  tabs.close(ids[2]);
  await host.settle();
  assert.equal(snapshotOf(tabs).set.liveId, ids[0]);
  assert.equal(focusedThread(host.shown.at(-1)), "thr_alpha");
});

test("closing a parked tab leaves bb's layout alone, and the last tab stays", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.close(ids[0]);
  tabs.close(ids[1]);
  assert.equal(host.shown.length, 0);
  tabs.close(ids[2]);
  assert.deepEqual(snapshotOf(tabs).set.tabs.map((tab) => tab.id), [ids[2]]);
});

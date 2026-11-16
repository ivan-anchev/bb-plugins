import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import assert from "node:assert/strict";
import { test } from "node:test";
import { focused, panes, single, type Layout, type Pane } from "../model/layout.ts";
import type { SavedTabs } from "../model/saved.ts";
import type { TabSet } from "../model/tab-set.ts";
import { createTabsController, type HostLayout, type Nav } from "./tabs-controller.ts";

type Shown = Awaited<ReturnType<HostLayout["show"]>>;

/**
 * bb as the test drives it: `layout` is what bb holds, and each write stays in flight until `settle`, `fail`,
 * or its signal aborts.
 */
type FakeHost = HostLayout & {
  layout: Layout | null;
  /** Every layout written, in order. */
  shown: Layout[];
  /** bb finishes the write in flight, exactly unless it says otherwise. */
  settle(shown?: Shown): Promise<void>;
  /** The write in flight fails. */
  fail(error: Error): Promise<void>;
};

function fakeHost(initial: Layout | null): FakeHost {
  const writes: { resolve: (shown: Shown) => void; reject: (error: Error) => void }[] = [];
  const host: FakeHost = {
    layout: initial,
    shown: [],
    read: () => host.layout,
    show(layout, _nav, signal) {
      host.shown.push(layout);
      host.layout = layout;
      return new Promise<Shown>((resolve, reject) => {
        writes.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    },
    async settle(shown = "exact") {
      writes.shift()?.resolve(shown);
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

/** The window's saved tabs: `set` is what is saved, and `saves` counts the saves. */
type FakeSaved = SavedTabs & { set: TabSet | null; saves: number };

function fakeSaved(initial: TabSet | null = null): FakeSaved {
  const saved: FakeSaved = {
    set: initial,
    saves: 0,
    load: () => saved.set,
    save(set) {
      saved.set = set;
      saved.saves += 1;
    },
  };
  return saved;
}

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

function controller(initial: Layout | null, saved = fakeSaved()) {
  const host = fakeHost(initial);
  const tabs = createTabsController(host);
  const unbind = tabs.bind(nav, saved);
  return { host, tabs, unbind, saved };
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

test("a thread created on a + tab stays that tab's when the user switches away before bb's change is observed", async () => {
  const { host, tabs } = controller(alpha);
  tabs.observe("thread");
  const first = snapshotOf(tabs).set.liveId;
  tabs.openNew();
  await host.settle();
  tabs.observe("workspace");
  const plus = snapshotOf(tabs).set.liveId;
  const created = thread("thr_bravo", liveLayout(tabs).focusedPaneId);
  // bb routes to the thread it created; the click on another tab comes before the overlay observes that.
  host.layout = created;
  tabs.activate(first);
  await host.settle();
  assert.deepEqual(snapshotOf(tabs).set.tabs.find((tab) => tab.id === plus)?.layout, created);
  tabs.activate(plus);
  await host.settle();
  assert.equal(focusedThread(host.shown.at(-1)), "thr_bravo");
});

test("a switch made while a write is in flight leaves the tab being written as it was", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.activate(ids[0]);
  const target = liveLayout(tabs);
  // bb is part way through taking the write.
  host.layout = thread("thr_delta");
  tabs.activate(ids[1]);
  await host.settle();
  await host.settle();
  assert.deepEqual(snapshotOf(tabs).set.tabs[0].layout, target);
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

test("the first tab shown at equal sizes raises the notice; once dismissed it stays down", async () => {
  const { host, tabs, ids } = await threeTabs();
  assert.equal(snapshotOf(tabs).notice, false);
  tabs.activate(ids[0]);
  await host.settle("equal-splits");
  assert.equal(snapshotOf(tabs).notice, true);
  tabs.dismissNotice();
  assert.equal(snapshotOf(tabs).notice, false);
  tabs.activate(ids[1]);
  await host.settle("equal-splits");
  assert.equal(snapshotOf(tabs).notice, false);
});

test("tabs shown at their exact sizes raise no notice", async () => {
  const { host, tabs, ids } = await threeTabs();
  for (const id of [ids[0], ids[1], ids[2]]) {
    tabs.activate(id);
    await host.settle();
  }
  assert.equal(snapshotOf(tabs).notice, false);
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

test("stepping shows the next or previous tab, wrapping past either end", async () => {
  const { host, tabs } = await threeTabs();
  const shownAfter = async (delta: 1 | -1) => {
    tabs.step(delta);
    await host.settle();
    return focusedThread(host.shown.at(-1));
  };
  assert.equal(await shownAfter(1), "thr_alpha");
  assert.equal(await shownAfter(1), "thr_bravo");
  assert.equal(await shownAfter(-1), "thr_alpha");
  assert.equal(await shownAfter(-1), "thr_charlie");
});

test("from Settings, stepping counts from the tab that was on screen", async () => {
  const { host, tabs } = await threeTabs();
  tabs.observe("page");
  tabs.step(-1);
  await host.settle();
  assert.equal(focusedThread(host.shown.at(-1)), "thr_bravo");
});

test("going to tab N shows it, and to a tab past the last does nothing", async () => {
  const { host, tabs, ids } = await threeTabs();
  tabs.goTo(1);
  await host.settle();
  assert.equal(snapshotOf(tabs).selectedId, ids[0]);
  assert.equal(focusedThread(host.shown.at(-1)), "thr_alpha");
  tabs.goTo(4);
  assert.equal(host.shown.length, 1);
  assert.equal(snapshotOf(tabs).selectedId, ids[0]);
});

test("tells whether there is a tab to step to, and whether tab N exists", async () => {
  const { tabs } = controller(alpha);
  assert.equal(tabs.canStep(), false);
  assert.equal(tabs.has(1), false);
  tabs.observe("thread");
  assert.equal(tabs.canStep(), false);
  assert.equal(tabs.has(1), true);
  tabs.openNew();
  assert.equal(tabs.canStep(), true);
  assert.equal(tabs.has(2), true);
  assert.equal(tabs.has(3), false);
});

/** A valid sidebar row for `threadId`, in project `projectId`. */
function sidebarThread(threadId: string, projectId: string): PluginSidebarThread {
  return {
    id: threadId,
    projectId,
    title: threadId,
    titleFallback: null,
    displayTitle: threadId,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/${projectId}/threads/${threadId}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  };
}

function split(left: Pane, right: Pane): Layout {
  return { root: { type: "split", dir: "row", sizes: [0.5, 0.5], children: [left, right] }, focusedPaneId: left.paneId };
}

function threadPane(threadId: string, paneId: string): Pane {
  return { type: "pane", paneId, content: { kind: "thread", projectId: "proj_a", threadId } };
}

/**
 * Tab 1 on Alpha | Bravo (Alpha focused), on screen; tab 2 on Delta | Charlie (Delta focused). The sidebar's
 * index has every thread, Echo's in another project, unless `indexed` is false.
 */
async function sidebarTabs(indexed = true) {
  const { host, tabs } = controller(split(threadPane("thr_alpha", "pane-1"), threadPane("thr_bravo", "pane-2")));
  tabs.observe("thread");
  tabs.openNew();
  await host.settle();
  host.layout = split(threadPane("thr_delta", "pane-3"), threadPane("thr_charlie", "pane-4"));
  tabs.observe("thread");
  const ids = snapshotOf(tabs).set.tabs.map((tab) => tab.id);
  tabs.activate(ids[0]);
  await host.settle();
  if (indexed) {
    const threads = ["thr_alpha", "thr_bravo", "thr_charlie", "thr_delta"].map((id) => sidebarThread(id, "proj_a"));
    tabs.syncThreads({ status: "ready", threads: [...threads, sidebarThread("thr_echo", "proj_e")], projects: [], sections: [], experimental_archived: null });
  }
  host.shown.length = 0;
  return { host, tabs, ids };
}

test("a plain click on a thread another tab shows selects that tab, with the thread's pane focused", async () => {
  const { host, tabs, ids } = await sidebarTabs();
  assert.equal(tabs.routeSidebarClick("thr_charlie", "plain"), true);
  await host.settle();
  assert.equal(snapshotOf(tabs).selectedId, ids[1]);
  assert.equal(host.shown.length, 1);
  assert.equal(focusedThread(host.shown[0]), "thr_charlie");
  assert.deepEqual(panes(host.shown[0]).map((pane) => pane.content), [
    { kind: "thread", projectId: "proj_a", threadId: "thr_delta" },
    { kind: "thread", projectId: "proj_a", threadId: "thr_charlie" },
  ]);
});

test("a plain click on a thread the tab on screen shows, or no tab shows, is left to bb", async () => {
  const { host, tabs } = await sidebarTabs();
  const before = snapshotOf(tabs);
  for (const threadId of ["thr_bravo", "thr_alpha", "thr_echo"]) {
    assert.equal(tabs.routeSidebarClick(threadId, "plain"), false, threadId);
  }
  assert.equal(host.shown.length, 0);
  assert.equal(snapshotOf(tabs), before);
});

test("a new-tab gesture opens a selected tab right of the one on screen with the thread alone, even one a tab shows", async () => {
  const { host, tabs, ids } = await sidebarTabs();
  const opened: string[] = [];
  for (const [threadId, projectId] of [["thr_echo", "proj_e"], ["thr_alpha", "proj_a"]]) {
    assert.equal(tabs.routeSidebarClick(threadId, "newTab"), true, threadId);
    await host.settle();
    const { set, selectedId } = snapshotOf(tabs);
    opened.push(set.liveId);
    assert.equal(selectedId, set.liveId);
    assert.deepEqual(panes(liveLayout(tabs)).map((pane) => pane.content), [{ kind: "thread", projectId, threadId }]);
    assert.deepEqual(host.shown.at(-1), liveLayout(tabs));
  }
  assert.deepEqual(snapshotOf(tabs).set.tabs.map((tab) => tab.id), [ids[0], ...opened, ids[1]]);
});

test("a new-tab gesture is left to bb until the sidebar's index has the thread", async () => {
  const { host, tabs } = await sidebarTabs(false);
  assert.equal(tabs.routeSidebarClick("thr_echo", "newTab"), false);
  assert.equal(host.shown.length, 0);
  assert.equal(snapshotOf(tabs).set.tabs.length, 2);
});

/** Saved tabs on Alpha | Bravo, Delta, and Charlie, with Delta's live: what a window saved before its reload. */
function savedBeforeReload(): TabSet {
  return {
    tabs: [
      { id: "t1", layout: split(threadPane("thr_alpha", "t1-1"), threadPane("thr_bravo", "t1-2")) },
      { id: "t2", layout: thread("thr_delta", "t2-1") },
      { id: "t3", layout: thread("thr_charlie", "t3-1") },
    ],
    liveId: "t2",
  };
}

test("after a reload the saved tabs come back, the live one selected with bb's restored layout, and nothing is written to bb", () => {
  const restored = thread("thr_delta", "t2-1");
  const { host, tabs } = controller(restored, fakeSaved(savedBeforeReload()));
  tabs.observe("thread");
  const { set, selectedId } = snapshotOf(tabs);
  assert.deepEqual(set, savedBeforeReload());
  assert.equal(selectedId, "t2");
  assert.equal(host.shown.length, 0);
});

test("a saved live tab takes the layout bb restored, and parked tabs keep theirs", () => {
  const restored = split(threadPane("thr_delta", "t2-1"), threadPane("thr_echo", "t2-2"));
  const { tabs } = controller(restored, fakeSaved(savedBeforeReload()));
  tabs.observe("thread");
  const [t1, , t3] = savedBeforeReload().tabs;
  assert.deepEqual(snapshotOf(tabs).set, { tabs: [t1, { id: "t2", layout: restored }, t3], liveId: "t2" });
});

test("every change is saved, and nothing once unbound", async () => {
  const { host, tabs, unbind, saved } = controller(alpha);
  tabs.observe("thread");
  assert.deepEqual(saved.set, snapshotOf(tabs).set);
  tabs.openNew();
  assert.deepEqual(saved.set, snapshotOf(tabs).set);
  await host.settle();
  const saves = saved.saves;
  unbind();
  tabs.close(snapshotOf(tabs).set.liveId);
  assert.equal(saved.saves, saves);
});

test("only the first bind loads the saved tabs", () => {
  const { tabs } = controller(alpha);
  tabs.observe("thread");
  const before = snapshotOf(tabs).set;
  tabs.bind(nav, fakeSaved(savedBeforeReload()));
  tabs.observe("thread");
  assert.deepEqual(snapshotOf(tabs).set, before);
});

test("archived or deleted threads leave parked tabs, a parked tab left empty goes, and the live tab is left to bb", () => {
  const { tabs } = controller(thread("thr_delta", "t2-1"), fakeSaved(savedBeforeReload()));
  tabs.observe("thread");
  const index = ["thr_alpha", "thr_echo"].map((id) => sidebarThread(id, "proj_a"));
  tabs.syncThreads({ status: "ready", threads: index, projects: [], sections: [], experimental_archived: null });
  const { set } = snapshotOf(tabs);
  assert.deepEqual(set, {
    tabs: [
      { id: "t1", layout: thread("thr_alpha", "t1-1") },
      { id: "t2", layout: thread("thr_delta", "t2-1") },
    ],
    liveId: "t2",
  });
});

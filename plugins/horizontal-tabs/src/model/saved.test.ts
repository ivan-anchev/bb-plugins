import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { single, type Layout } from "./layout.ts";
import { savedTabs } from "./saved.ts";
import type { TabSet } from "./tab-set.ts";

const KEY = "horizontal-tabs:tabs";

/** A Web Storage area in memory, as the browser gives each window. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

beforeEach(() => {
  for (const name of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true });
  }
});

function thread(threadId: string): Layout {
  return single({ kind: "thread", projectId: "proj_a", threadId }, `pane-${threadId}`);
}

function tabsOn(threadIds: string[], liveIndex: number): TabSet {
  const tabs = threadIds.map((threadId, i) => ({ id: `t${i + 1}`, layout: thread(threadId) }));
  return { tabs, liveId: tabs[liveIndex].id };
}

/** Writes an envelope by hand, as an older or newer plugin, or a person, might have left it. */
function store(area: Storage, envelope: unknown): void {
  area.setItem(KEY, JSON.stringify(envelope));
}

test("saves each change to the window's copy and the device's, and loads it back", () => {
  const set = tabsOn(["thr_a", "thr_b", "thr_c"], 1);
  savedTabs("horizontal-tabs").save(set);
  assert.deepEqual(JSON.parse(sessionStorage.getItem(KEY)!), { version: 1, ...set });
  assert.equal(localStorage.getItem(KEY), sessionStorage.getItem(KEY));
  assert.deepEqual(savedTabs("horizontal-tabs").load(), set);
});

test("loads the window's own tabs before the device's, and the device's in a fresh window", () => {
  store(sessionStorage, { version: 1, ...tabsOn(["thr_a"], 0) });
  store(localStorage, { version: 1, ...tabsOn(["thr_b", "thr_c"], 1) });
  assert.deepEqual(savedTabs("horizontal-tabs").load(), tabsOn(["thr_a"], 0));
  sessionStorage.clear();
  assert.deepEqual(savedTabs("horizontal-tabs").load(), tabsOn(["thr_b", "thr_c"], 1));
});

test("keeps each plugin id's tabs apart", () => {
  savedTabs("horizontal-tabs").save(tabsOn(["thr_a"], 0));
  assert.equal(savedTabs("horizontal-tabs-copy").load(), null);
});

test("drops only the tabs it can't read, and makes the first tab live when the live one is dropped", () => {
  const { tabs } = tabsOn(["thr_a", "thr_b"], 0);
  // Deliberately off-type: a pane kind from a newer bb or plugin.
  const future = { id: "t9", layout: { root: { type: "pane", paneId: "pane-9", content: { kind: "future-kind" } }, focusedPaneId: "pane-9" } };
  store(sessionStorage, { version: 1, tabs: [tabs[0], future, tabs[1], { id: "t8" }], liveId: "t9" });
  assert.deepEqual(savedTabs("horizontal-tabs").load(), { tabs, liveId: "t1" });
});

test("keeps the first of tabs saved under one id, so each id names one tab", () => {
  const [a, b, c] = tabsOn(["thr_a", "thr_b", "thr_c"], 0).tabs;
  store(sessionStorage, { version: 1, tabs: [a, { ...b, id: a.id }, c, { ...c, layout: thread("thr_d") }], liveId: c.id });
  assert.deepEqual(savedTabs("horizontal-tabs").load(), { tabs: [a, c], liveId: c.id });
});

test("loads nothing when nothing saved can be read", () => {
  const set = tabsOn(["thr_a"], 0);
  const unreadable = [{ version: 2, ...set }, { version: 1, tabs: [{ id: "t1" }], liveId: "t1" }, { version: 1, tabs: [], liveId: "t1" }, "{"];
  assert.equal(savedTabs("horizontal-tabs").load(), null);
  for (const stored of unreadable) {
    sessionStorage.setItem(KEY, typeof stored === "string" ? stored : JSON.stringify(stored));
    assert.equal(savedTabs("horizontal-tabs").load(), null, JSON.stringify(stored));
  }
});

test("a window whose own copy can't be read falls back to the device's", () => {
  store(sessionStorage, { version: 2, ...tabsOn(["thr_a"], 0) });
  store(localStorage, { version: 1, ...tabsOn(["thr_b"], 0) });
  assert.deepEqual(savedTabs("horizontal-tabs").load(), tabsOn(["thr_b"], 0));
});

test("saves again after a write fails, even when the tabs did not change", (t) => {
  const saved = savedTabs("horizontal-tabs");
  const set = tabsOn(["thr_a", "thr_b"], 1);
  t.mock.method(console, "warn", () => {});
  const full = t.mock.method(localStorage, "setItem", () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  });
  saved.save(set);
  full.mock.restore();
  saved.save(set);
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY)!), { version: 1, ...set });
});

test("saves the earlier tabs again after a later save half fails, so a reload brings back the earlier ones", (t) => {
  const saved = savedTabs("horizontal-tabs");
  const before = tabsOn(["thr_a", "thr_b"], 0);
  const after = tabsOn(["thr_a", "thr_b"], 1);
  saved.save(before);
  t.mock.method(console, "warn", () => {});
  const full = t.mock.method(localStorage, "setItem", () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  });
  saved.save(after);
  full.mock.restore();
  saved.save(before);
  assert.deepEqual(savedTabs("horizontal-tabs").load(), before);
});

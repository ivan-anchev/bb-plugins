import assert from "node:assert/strict";
import { test } from "node:test";
import { single, type Layout, type Pane } from "./layout.ts";
import { adopt, close, locate, makeLive, nth, open, prune, seed, step, type TabSet } from "./tab-set.ts";

function threadLayout(threadId: string): Layout {
  return single({ kind: "thread", projectId: "proj_a", threadId }, "pane-1");
}

test("seed makes one live tab holding the layout", () => {
  assert.deepEqual(seed("t1", threadLayout("thr_a")), { tabs: [{ id: "t1", layout: threadLayout("thr_a") }], liveId: "t1" });
});

test("adopt replaces only the live tab's layout", () => {
  const set: TabSet = {
    tabs: [
      { id: "t1", layout: threadLayout("thr_a") },
      { id: "t2", layout: threadLayout("thr_b") },
      { id: "t3", layout: threadLayout("thr_c") },
    ],
    liveId: "t2",
  };
  assert.deepEqual(adopt(set, threadLayout("thr_z")), {
    tabs: [
      { id: "t1", layout: threadLayout("thr_a") },
      { id: "t2", layout: threadLayout("thr_z") },
      { id: "t3", layout: threadLayout("thr_c") },
    ],
    liveId: "t2",
  });
});

function tabsOf(count: number, live: string): TabSet {
  return { tabs: Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, layout: threadLayout(`thr_${i + 1}`) })), liveId: live };
}

const ids = (set: TabSet) => set.tabs.map((tab) => tab.id);

test("open puts the tab right of the live one and makes it live", () => {
  const set = open(tabsOf(3, "t2"), { id: "new", layout: threadLayout("thr_new") });
  assert.deepEqual(ids(set), ["t1", "t2", "new", "t3"]);
  assert.equal(set.liveId, "new");
});

test("makeLive makes the tab live with the layout given, and leaves the others", () => {
  const set = makeLive(tabsOf(3, "t1"), "t3", threadLayout("thr_renamed"));
  assert.equal(set.liveId, "t3");
  assert.deepEqual(set.tabs.map((tab) => tab.layout), [threadLayout("thr_1"), threadLayout("thr_2"), threadLayout("thr_renamed")]);
});

test("closing the live tab hands over to its right neighbour", () => {
  const set = close(tabsOf(3, "t2"), "t2");
  assert.deepEqual(ids(set), ["t1", "t3"]);
  assert.equal(set.liveId, "t3");
});

test("closing the rightmost live tab hands over to its left neighbour", () => {
  const set = close(tabsOf(3, "t3"), "t3");
  assert.deepEqual(ids(set), ["t1", "t2"]);
  assert.equal(set.liveId, "t2");
});

test("closing a parked tab keeps the live one", () => {
  const set = close(tabsOf(3, "t3"), "t1");
  assert.deepEqual(ids(set), ["t2", "t3"]);
  assert.equal(set.liveId, "t3");
});

test("the last tab stays", () => {
  assert.deepEqual(close(tabsOf(1, "t1"), "t1"), tabsOf(1, "t1"));
});

test("step goes to the neighbour and wraps past either end", () => {
  const set = tabsOf(3, "t1");
  assert.equal(step(set, "t1", 1).id, "t2");
  assert.equal(step(set, "t3", 1).id, "t1");
  assert.equal(step(set, "t1", -1).id, "t3");
  assert.equal(step(set, "t2", -1).id, "t1");
});

test("nth counts from 1 and finds nothing past the last tab", () => {
  const set = tabsOf(3, "t1");
  assert.equal(nth(set, 1)?.id, "t1");
  assert.equal(nth(set, 3)?.id, "t3");
  assert.equal(nth(set, 4), undefined);
});

test("locate finds the tab and pane showing a thread, the live tab first, then from the left", () => {
  const pane = (paneId: string, threadId: string): Pane => ({ type: "pane", paneId, content: { kind: "thread", projectId: "proj_a", threadId } });
  const split = (left: Pane, right: Pane): Layout => ({ root: { type: "split", dir: "row", sizes: [0.5, 0.5], children: [left, right] }, focusedPaneId: left.paneId });
  const set: TabSet = {
    tabs: [
      { id: "t1", layout: split(pane("t1-1", "thr_a"), pane("t1-2", "thr_b")) },
      { id: "t2", layout: split(pane("t2-1", "thr_c"), pane("t2-2", "thr_b")) },
      { id: "t3", layout: split(pane("t3-1", "thr_b"), pane("t3-2", "thr_a")) },
    ],
    liveId: "t3",
  };
  const found = (threadId: string) => {
    const hit = locate(set, threadId);
    return hit && `${hit.tab.id}/${hit.pane.paneId}`;
  };
  assert.equal(found("thr_b"), "t3/t3-1");
  assert.equal(found("thr_a"), "t3/t3-2");
  assert.equal(found("thr_c"), "t2/t2-1");
  assert.equal(locate({ ...set, liveId: "t2" }, "thr_a")?.tab.id, "t1");
  assert.equal(found("thr_z"), undefined);
});

test("prune drops gone threads from parked tabs, removes parked tabs left empty, and leaves the live tab to bb", () => {
  const set = tabsOf(4, "t3");
  const pruned = prune(set, (threadId) => threadId === "thr_1");
  assert.deepEqual(pruned, { tabs: [set.tabs[0], set.tabs[2]], liveId: "t3" });
});

test("prune keeps the panes of threads still there", () => {
  const pane = (paneId: string, threadId: string): Pane => ({ type: "pane", paneId, content: { kind: "thread", projectId: "proj_a", threadId } });
  const layout: Layout = { root: { type: "split", dir: "row", sizes: [0.5, 0.5], children: [pane("p1", "thr_a"), pane("p2", "thr_b")] }, focusedPaneId: "p2" };
  const set: TabSet = { tabs: [{ id: "t1", layout }, { id: "t2", layout: threadLayout("thr_c") }], liveId: "t2" };
  assert.deepEqual(prune(set, (threadId) => threadId !== "thr_b").tabs[0].layout, { root: pane("p1", "thr_a"), focusedPaneId: "p1" });
});

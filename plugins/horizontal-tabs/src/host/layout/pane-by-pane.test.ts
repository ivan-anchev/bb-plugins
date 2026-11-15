import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Nav } from "../../controller/tabs-controller.ts";
import { single, type Layout, type LayoutNode, type Pane, type PaneContent } from "../../model/layout.ts";
import { rebuildPaneByPane } from "./pane-by-pane.ts";

/**
 * bb as the SDK drives it, flattened to one row of panes (bb's split opens right of the focused pane, at equal
 * sizes). A navigation shows on the next frame, as bb renders it, and only then reaches sessionStorage and the
 * panes on screen; the panes' own focus marker follows a frame later still. `onPage`: Settings is on screen,
 * so none of bb's panes are.
 */
const bb: {
  panes: Pane[];
  focusedPaneId: string;
  /** The pane bb's panes mark focused (`data-focused`). */
  markedPaneId: string;
  onPage: boolean;
  nextId: number;
  /** Navigations bb has not rendered yet. */
  pending: (() => void)[];
  /** Navigations and pane closes asked of bb. */
  navigations: number;
} = { panes: [], focusedPaneId: "", markedPaneId: "", onPage: false, nextId: 1, pending: [], navigations: 0 };

function bbHolds(contents: PaneContent[], focus: number): void {
  bb.panes = contents.map((content) => ({ type: "pane", paneId: `pane-${bb.nextId++}`, content }));
  bb.focusedPaneId = bb.panes[focus].paneId;
  bb.markedPaneId = bb.focusedPaneId;
  store();
}

function bbLayout(): Layout {
  const root: LayoutNode =
    bb.panes.length === 1
      ? bb.panes[0]
      : { type: "split", dir: "row", sizes: bb.panes.map(() => 1 / bb.panes.length), children: bb.panes };
  return { root, focusedPaneId: bb.focusedPaneId };
}

function store(): void {
  stored.set("bb.splitLayout", JSON.stringify({ version: 1, layout: bbLayout() }));
}

function later(change: () => void): void {
  bb.navigations += 1;
  bb.pending.push(() => {
    change();
    bb.onPage = false;
  });
}

const focusedIndex = () => bb.panes.findIndex((pane) => pane.paneId === bb.focusedPaneId);

const nav: Nav = {
  toThread(threadId, options) {
    later(() => {
      const open = bb.panes.find((pane) => pane.content.kind === "thread" && pane.content.threadId === threadId);
      const content: PaneContent = { kind: "thread", projectId: "proj_a", threadId };
      if (open !== undefined) bb.focusedPaneId = open.paneId;
      else if (options?.split) {
        const pane: Pane = { type: "pane", paneId: `pane-${bb.nextId++}`, content };
        bb.panes.splice(focusedIndex() + 1, 0, pane);
        bb.focusedPaneId = pane.paneId;
      } else bb.panes[focusedIndex()] = { ...bb.panes[focusedIndex()], content };
    });
  },
  toCompose() {
    later(() => (bb.panes[focusedIndex()] = { ...bb.panes[focusedIndex()], content: { kind: "new-thread" } }));
  },
};

// Node has no browser globals; these stand in for the ones the rebuild reads.
const stored = new Map<string, string>();
const storage: Pick<Storage, "getItem"> = { getItem: (key) => stored.get(key) ?? null };
const onScreen = () => (bb.onPage ? [] : bb.panes);
// bb's panes on screen, each with its header's Close pane button (the one element looked up inside a pane).
const page = {
  querySelectorAll: () =>
    onScreen().map((pane) => ({
      getAttribute: (name: string) => (name === "data-focused" ? String(pane.paneId === bb.markedPaneId) : pane.paneId),
      querySelector: () => ({ click: () => later(() => bb.panes.splice(bb.panes.indexOf(pane), 1)) }),
    })),
};
const frames = new Map<number, () => void>();
let lastFrame = 0;
Object.defineProperty(globalThis, "sessionStorage", { value: storage });
Object.defineProperty(globalThis, "document", { value: page });
Object.defineProperty(globalThis, "requestAnimationFrame", {
  value: (callback: () => void) => {
    frames.set(++lastFrame, callback);
    setImmediate(nextFrame);
    return lastFrame;
  },
});
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: (frame: number) => frames.delete(frame) });

/** bb renders what it was asked, then the frame's callbacks run. */
function nextFrame(): void {
  bb.markedPaneId = bb.focusedPaneId;
  bb.pending.splice(0).forEach((change) => change());
  store();
  const due = [...frames.values()];
  frames.clear();
  due.forEach((callback) => callback());
}

beforeEach(() => {
  bb.onPage = false;
  bb.pending = [];
  bb.navigations = 0;
});

const thread = (threadId: string): PaneContent => ({ kind: "thread", projectId: "proj_a", threadId });
const pane = (threadId: string, paneId: string): Pane => ({ type: "pane", paneId, content: thread(threadId) });

/** What bb shows: its panes' contents in order, and the focused one. */
function bbShows() {
  return { panes: bb.panes.map((pane) => pane.content), focus: bb.panes[focusedIndex()].content };
}

/** T1 = [A 0.6 | [B 0.3 / C 0.7]], focus B. */
const t1: Layout = {
  root: {
    type: "split",
    dir: "row",
    sizes: [0.6, 0.4],
    children: [pane("thr_a", "t1-1"), { type: "split", dir: "col", sizes: [0.3, 0.7], children: [pane("thr_b", "t1-2"), pane("thr_c", "t1-3")] }],
  },
  focusedPaneId: "t1-2",
};

test("rebuilds a split tab as its threads side by side at equal sizes, with its focused thread focused", async () => {
  bbHolds([thread("thr_d"), thread("thr_e")], 1);
  await rebuildPaneByPane(t1, nav, new AbortController().signal);
  assert.deepEqual(bbShows(), { panes: [thread("thr_a"), thread("thr_b"), thread("thr_c")], focus: thread("thr_b") });
});

test("closes the panes bb doesn't focus, though its panes still mark the pane focus just left", async () => {
  bbHolds([thread("thr_d")], 0);
  // Ends by focusing Alpha's pane, left of Bravo's; for a frame bb's panes still mark Bravo focused.
  const ab: Layout = { root: { type: "split", dir: "row", sizes: [0.5, 0.5], children: [pane("thr_a", "ab-1"), pane("thr_b", "ab-2")] }, focusedPaneId: "ab-1" };
  await rebuildPaneByPane(ab, nav, new AbortController().signal);
  const ae: Layout = { root: { type: "split", dir: "row", sizes: [0.5, 0.5], children: [pane("thr_a", "ae-1"), pane("thr_e", "ae-2")] }, focusedPaneId: "ae-2" };
  await rebuildPaneByPane(ae, nav, new AbortController().signal);
  assert.deepEqual(bbShows(), { panes: [thread("thr_a"), thread("thr_e")], focus: thread("thr_e") });
});

test("rebuilds a tab from Settings, where none of bb's panes are on screen", async () => {
  bbHolds([thread("thr_a"), thread("thr_d")], 1);
  bb.onPage = true;
  await rebuildPaneByPane(t1, nav, new AbortController().signal);
  assert.deepEqual(bbShows(), { panes: [thread("thr_a"), thread("thr_b"), thread("thr_c")], focus: thread("thr_b") });
  assert.equal(bb.onPage, false);
});

test("leaves out New thread and plugin panes beside the threads", async () => {
  bbHolds([thread("thr_d")], 0);
  const mixed: Layout = {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.25, 0.25, 0.25, 0.25],
      children: [
        { type: "pane", paneId: "m-1", content: { kind: "new-thread" } },
        pane("thr_a", "m-2"),
        { type: "pane", paneId: "m-3", content: { kind: "plugin-detail", pluginId: "notes" } },
        pane("thr_b", "m-4"),
      ],
    },
    focusedPaneId: "m-2",
  };
  await rebuildPaneByPane(mixed, nav, new AbortController().signal);
  assert.deepEqual(bbShows(), { panes: [thread("thr_a"), thread("thr_b")], focus: thread("thr_a") });
});

test("shows a + tab's New thread screen alone", async () => {
  bbHolds([thread("thr_a"), thread("thr_b")], 0);
  await rebuildPaneByPane(single({ kind: "new-thread" }, "t2-1"), nav, new AbortController().signal);
  assert.deepEqual(bbShows(), { panes: [{ kind: "new-thread" }], focus: { kind: "new-thread" } });
});

test("once aborted, it rejects and navigates no more", async () => {
  bbHolds([thread("thr_d"), thread("thr_e")], 1);
  const abort = new AbortController();
  const rebuilt = rebuildPaneByPane(t1, nav, abort.signal);
  assert.equal(bb.navigations, 1);
  abort.abort();
  await assert.rejects(rebuilt, { name: "AbortError" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bb.navigations, 1);
  assert.equal(frames.size, 0);
});

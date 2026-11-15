import assert from "node:assert/strict";
import { test } from "node:test";
import { focused, layoutSchema, panes, single, withoutThreads, withPaneIdsApart, type Layout, type Pane } from "./layout.ts";

function thread(paneId: string, threadId: string): Pane {
  return { type: "pane", paneId, content: { kind: "thread", projectId: "proj_a", threadId } };
}

/** [A 0.6 | [B 0.3 / C 0.7]], C focused: the layout-restore probe's target. */
function target(): Layout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.6, 0.4],
      children: [
        thread("pane-a", "thr_a"),
        { type: "split", dir: "col", sizes: [0.3, 0.7], children: [thread("pane-b", "thr_b"), thread("pane-c", "thr_c")] },
      ],
    },
    focusedPaneId: "pane-c",
  };
}

function rowOf(count: number): Layout {
  const children = Array.from({ length: count }, (_, i) => thread(`pane-${i}`, `thr_${i}`));
  return { root: { type: "split", dir: "row", sizes: children.map(() => 1 / count), children }, focusedPaneId: "pane-0" };
}

test("accepts a nested row and column split, and reads its panes and focus", () => {
  const layout = layoutSchema.parse(target());
  assert.deepEqual(panes(layout).map((pane) => pane.paneId), ["pane-a", "pane-b", "pane-c"]);
  assert.equal(focused(layout).paneId, "pane-c");
});

test("accepts every pane kind bb stores", () => {
  const layout: Layout = {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.25, 0.25, 0.25, 0.25],
      children: [
        thread("pane-1", "thr_a"),
        { type: "pane", paneId: "pane-2", content: { kind: "new-thread" } },
        { type: "pane", paneId: "pane-3", content: { kind: "plugin-panel", pluginId: "notes", panelPath: "notes", subPath: "" } },
        { type: "pane", paneId: "pane-4", content: { kind: "plugin-detail", pluginId: "notes" } },
      ],
    },
    focusedPaneId: "pane-1",
  };
  assert.equal(layoutSchema.safeParse(layout).success, true);
});

test("accepts bb's eight-pane row, whose sizes are below the [0.15, 0.85] bb draws with", () => {
  assert.equal(layoutSchema.safeParse(rowOf(8)).success, true);
});

test("rejects a split direction bb doesn't have", () => {
  const layout = { ...target(), root: { ...target().root, dir: "column" } };
  assert.equal(layoutSchema.safeParse(layout).success, false);
});

test("rejects sizes that are not positive, don't sum to 1, or don't match the children", () => {
  const withSizes = (sizes: number[]) => ({ ...target(), root: { ...target().root, sizes } });
  assert.equal(layoutSchema.safeParse(withSizes([1, 0])).success, false);
  assert.equal(layoutSchema.safeParse(withSizes([0.1, 0.4])).success, false);
  assert.equal(layoutSchema.safeParse(withSizes([0.6, 0.3, 0.1])).success, false);
});

test("rejects more than eight panes", () => {
  assert.equal(layoutSchema.safeParse(rowOf(9)).success, false);
});

test("rejects duplicate pane ids", () => {
  const layout = { root: { type: "split", dir: "row", sizes: [0.5, 0.5], children: [thread("pane-1", "thr_a"), thread("pane-1", "thr_b")] }, focusedPaneId: "pane-1" };
  assert.equal(layoutSchema.safeParse(layout).success, false);
});

test("rejects a focused pane that isn't in the layout", () => {
  assert.equal(layoutSchema.safeParse({ ...target(), focusedPaneId: "pane-z" }).success, false);
});

test("rejects fields bb's strict schema doesn't know", () => {
  assert.equal(layoutSchema.safeParse({ ...target(), maximized: "pane-a" }).success, false);
});

const paneIds = (layout: Layout) => panes(layout).map((pane) => pane.paneId);

function pair(left: string, right: string): Layout {
  return { root: { type: "split", dir: "row", sizes: [0.5, 0.5], children: [thread(left, "thr_x"), thread(right, "thr_y")] }, focusedPaneId: right };
}

test("withPaneIdsApart renames only the pane ids the other layout uses, and the focus follows its pane", () => {
  const apart = withPaneIdsApart(target(), pair("pane-c", "pane-z"), "t1");
  assert.deepEqual(paneIds(apart), ["pane-a", "pane-b", "t1-1"]);
  assert.equal(apart.focusedPaneId, "t1-1");
  assert.deepEqual(focused(apart).content, focused(target()).content);
  assert.equal(layoutSchema.safeParse(apart).success, true);
});

test("withPaneIdsApart keeps the splits and sizes, and picks ids neither layout uses", () => {
  const apart = withPaneIdsApart(target(), pair("t1-1", "pane-a"), "t1");
  assert.deepEqual(paneIds(apart), ["t1-2", "pane-b", "pane-c"]);
  assert.deepEqual(apart.root.type === "split" ? apart.root.sizes : null, [0.6, 0.4]);
});

test("withPaneIdsApart leaves the layout as it is with no other layout, or no id in common", () => {
  assert.deepEqual(withPaneIdsApart(target(), null, "t1"), target());
  assert.deepEqual(withPaneIdsApart(target(), single({ kind: "new-thread" }, "pane-q"), "t1"), target());
});

/** Every thread but `gone`. */
const without = (...gone: string[]) => (threadId: string) => !gone.includes(threadId);

test("withoutThreads collapses a split left with one child into it, which takes the split's place and size", () => {
  const layout = withoutThreads(target(), without("thr_b"));
  assert.deepEqual(layout, {
    root: { type: "split", dir: "row", sizes: [0.6, 0.4], children: [thread("pane-a", "thr_a"), thread("pane-c", "thr_c")] },
    focusedPaneId: "pane-c",
  });
});

test("withoutThreads shares a split among the children left, keeping their proportions", () => {
  const children = [thread("pane-1", "thr_a"), thread("pane-2", "thr_b"), thread("pane-3", "thr_c"), thread("pane-4", "thr_d")];
  const layout = withoutThreads({ root: { type: "split", dir: "row", sizes: [0.1, 0.2, 0.3, 0.4], children }, focusedPaneId: "pane-1" }, without("thr_c"));
  assert.ok(layout);
  assert.deepEqual(layout.root.type === "split" && layout.root.sizes.map((size) => size.toFixed(4)), ["0.1429", "0.2857", "0.5714"]);
  assert.deepEqual(paneIds(layout), ["pane-1", "pane-2", "pane-4"]);
  assert.equal(layoutSchema.safeParse(layout).success, true);
});

test("withoutThreads moves a removed focus to the next pane left, else the previous one", () => {
  const focusAfter = (focusedPaneId: string, ...gone: string[]) => withoutThreads({ ...rowOf(4), focusedPaneId }, without(...gone))?.focusedPaneId;
  assert.equal(focusAfter("pane-1", "thr_1"), "pane-2");
  assert.equal(focusAfter("pane-1", "thr_1", "thr_2"), "pane-3");
  assert.equal(focusAfter("pane-3", "thr_3"), "pane-2");
  assert.equal(focusAfter("pane-3", "thr_2"), "pane-3");
});

test("withoutThreads keeps panes that show no thread, and is null when no pane is left", () => {
  const newThread: Pane = { type: "pane", paneId: "pane-n", content: { kind: "new-thread" } };
  const layout: Layout = { root: { type: "split", dir: "col", sizes: [0.5, 0.5], children: [thread("pane-a", "thr_a"), newThread] }, focusedPaneId: "pane-a" };
  assert.deepEqual(withoutThreads(layout, without("thr_a")), { root: newThread, focusedPaneId: "pane-n" });
  assert.equal(withoutThreads(target(), without("thr_a", "thr_b", "thr_c")), null);
  assert.deepEqual(withoutThreads(target(), without("thr_z")), target());
});

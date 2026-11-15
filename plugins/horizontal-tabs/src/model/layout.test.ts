import assert from "node:assert/strict";
import { test } from "node:test";
import { focused, layoutSchema, panes, type Layout, type Pane } from "./layout.ts";

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

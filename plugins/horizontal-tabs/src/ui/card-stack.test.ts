import assert from "node:assert/strict";
import { test } from "node:test";
import type { Layout, Pane, PaneContent } from "../model/layout.ts";
import { stackOf } from "./card-stack.ts";

const index = new Map([
  ["proj_a", "A"],
  ["proj_b", "B"],
]);
const projectOf = (id: string) => index.get(id);

function pane(paneId: string, content: PaneContent): Pane {
  return { type: "pane", paneId, content };
}

function thread(paneId: string, projectId: string): Pane {
  return pane(paneId, { kind: "thread", projectId, threadId: `thr_${paneId}` });
}

/** The panes side by side, `focusedPaneId` focused. */
function row(focusedPaneId: string, ...children: Pane[]): Layout {
  if (children.length === 1) return { root: children[0], focusedPaneId };
  return { root: { type: "split", dir: "row", sizes: children.map(() => 1 / children.length), children }, focusedPaneId };
}

test("puts the focused pane's project in front, then the other thread panes in reading order", () => {
  const panes = [thread("p1", "proj_a"), thread("p2", "proj_a"), thread("p3", "proj_b")];
  assert.deepEqual(stackOf(row("p1", ...panes), projectOf), ["A", "A", "B"]);
  assert.deepEqual(stackOf(row("p3", ...panes), projectOf), ["B", "A", "A"]);
  assert.deepEqual(stackOf(row("p2", thread("p1", "proj_b"), ...panes.slice(1)), projectOf), ["A", "B", "B"]);
});

test("one thread pane is one card", () => {
  assert.deepEqual(stackOf(row("p1", thread("p1", "proj_b")), projectOf), ["B"]);
});

test("caps the stack at three cards", () => {
  const panes = ["proj_a", "proj_a", "proj_b", "proj_a", "proj_b", "proj_a"].map((id, i) => thread(`p${i}`, id));
  assert.deepEqual(stackOf(row("p4", ...panes), projectOf), ["B", "A", "A"]);
});

test("gives non-thread panes no card, and leads with the first thread pane when one of them is focused", () => {
  const panes = [pane("p1", { kind: "new-thread" }), thread("p2", "proj_b"), pane("p3", { kind: "plugin-detail", pluginId: "x" }), thread("p4", "proj_a")];
  assert.deepEqual(stackOf(row("p1", ...panes), projectOf), ["B", "A"]);
  assert.deepEqual(stackOf(row("p1", pane("p1", { kind: "new-thread" })), projectOf), []);
});

test("skips projects the index doesn't know before capping", () => {
  const panes = [thread("p1", "proj_gone"), thread("p2", "proj_a"), thread("p3", "proj_gone"), thread("p4", "proj_b"), thread("p5", "proj_a")];
  assert.deepEqual(stackOf(row("p1", ...panes), projectOf), ["A", "B", "A"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { single, type Layout } from "./layout.ts";
import { adopt, seed, type TabSet } from "./tab-set.ts";

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

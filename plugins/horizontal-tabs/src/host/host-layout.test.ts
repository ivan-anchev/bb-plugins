import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { single } from "../model/layout.ts";
import { hostLayout } from "./host-layout.ts";

// Node has no sessionStorage; the module reads only getItem, so a map stands in for bb's tab storage.
const stored = new Map<string, string>();
const storage: Pick<Storage, "getItem"> = { getItem: (key) => stored.get(key) ?? null };
Object.defineProperty(globalThis, "sessionStorage", { value: storage });

beforeEach(() => stored.clear());

const alpha = single({ kind: "thread", projectId: "proj_a", threadId: "thr_alpha" }, "pane-1");

test("reads the layout bb stored", () => {
  stored.set("bb.splitLayout", JSON.stringify({ version: 1, layout: alpha }));
  assert.deepEqual(hostLayout.read(), alpha);
});

test("reads no layout before bb stores one, or after bb clears it", () => {
  assert.equal(hostLayout.read(), null);
  stored.set("bb.splitLayout", "");
  assert.equal(hostLayout.read(), null);
});

test("reads no layout from a stored value that is not JSON", () => {
  stored.set("bb.splitLayout", '{"version":1,"layout":');
  assert.equal(hostLayout.read(), null);
});

test("reads no layout from a stored layout in another format", () => {
  stored.set("bb.splitLayout", JSON.stringify({ version: 2, layout: alpha }));
  assert.equal(hostLayout.read(), null);
});

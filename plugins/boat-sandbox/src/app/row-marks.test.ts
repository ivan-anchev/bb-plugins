import assert from "node:assert/strict";
import { test } from "node:test";
import { boatRowIds } from "./row-marks.ts";

const BOAT_HOSTS = { boat_a: true, boat_b: true, mac: false };
const row = (id: string, host: string | null, parentThreadId: string | null = null) => ({
  id,
  parentThreadId,
  host: host === null ? null : { id: host, name: host },
});

test("a thread on a boat machine is marked; one on another machine or none is not", () => {
  assert.deepEqual([...boatRowIds([row("t1", "boat_a"), row("t2", "mac"), row("t3", null), row("t4", "unloaded")], BOAT_HOSTS)], ["t1"]);
});

test("a child on its parent's boat is not marked; on another boat, or under a local parent, it is", () => {
  const threads = [
    row("parent", "boat_a"),
    row("same-boat", "boat_a", "parent"),
    row("other-boat", "boat_b", "parent"),
    row("local-parent", "mac"),
    row("boat-under-local", "boat_a", "local-parent"),
  ];
  assert.deepEqual([...boatRowIds(threads, BOAT_HOSTS)].sort(), ["boat-under-local", "other-boat", "parent"]);
});

test("a child whose parent bb does not list keeps its icon", () => {
  assert.deepEqual([...boatRowIds([row("child", "boat_a", "archived-parent")], BOAT_HOSTS)], ["child"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { thread, WORKING } from "./fixtures.ts";
import { indexThreads } from "./thread-index.ts";

const TREE = [
  thread("root", { activity: { workflows: 0, backgroundAgents: 2, backgroundCommands: 0, planMode: 0, goals: 0 } }),
  thread("kid-running", { parentThreadId: "root", ...WORKING }),
  thread("kid-idle", { parentThreadId: "root" }),
  thread("grandkid-waiting", { parentThreadId: "kid-idle", indicator: "background-command" }),
  thread("grandkid-done", { parentThreadId: "kid-idle", indicator: "unread-success" }),
  thread("kid-hidden", { parentThreadId: "root", isHidden: true, ...WORKING }),
  thread("kid-archived", { parentThreadId: "root", isArchived: true, ...WORKING }),
  thread("other"),
];

test("runningUnder counts own background agents and every running descendant", () => {
  const index = indexThreads(TREE, new Set());
  // 2 background agents + kid-running + grandkid-waiting; hidden and archived kids don't count.
  assert.equal(index.runningUnder("root"), 4);
  assert.equal(index.runningUnder("kid-idle"), 1);
  assert.equal(index.runningUnder("other"), 0);
});

test("rootOf climbs to the parentless ancestor", () => {
  const index = indexThreads(TREE, new Set());
  assert.equal(index.rootOf("grandkid-done"), "root");
  assert.equal(index.rootOf("root"), "root");
  assert.equal(index.rootOf("kid-hidden"), null, "hidden threads are not in the index");
  assert.equal(index.rootOf("unknown"), null);
});

test("childrenOf and below leave hidden and archived threads out", () => {
  const index = indexThreads(TREE, new Set());
  assert.deepEqual(index.childrenOf("root").map((t) => t.id), ["kid-running", "kid-idle"]);
  assert.deepEqual(index.below("root").map((t) => t.id), ["kid-running", "kid-idle", "grandkid-waiting", "grandkid-done"]);
  assert.deepEqual(index.childrenOf("other"), []);
});

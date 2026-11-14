import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread, WORKING } from "../model/fixtures.ts";
import { HANDOFF_MS, nextHandoffs, nextRelease, NO_HANDOFFS, type Handoffs } from "./handoff.ts";

const WAITING = { indicator: "background-command" } as const;
const DONE = { indicator: "unread-success" } as const;

/** The hand-offs after each update in turn, the clock moving 1s per update. */
function run(...updates: PluginSidebarThread[][]): Handoffs {
  return updates.reduce((last, threads, i) => nextHandoffs(last, threads, i * 1_000), NO_HANDOFFS);
}

test("a thread whose wait ends is held, through a short turn and a second wake, never leaving Working", () => {
  const ended = run([thread("p", WAITING)], [thread("p", DONE)]);
  assert.deepEqual([...ended.held], [["p", 1_000 + HANDOFF_MS]]);
  const woke = nextHandoffs(ended, [thread("p", WORKING)], 2_000);
  assert.equal(woke.held.get("p"), 1_000 + HANDOFF_MS, "working inside the window keeps the hold");
  const settledAgain = nextHandoffs(woke, [thread("p", DONE)], 3_000);
  assert.equal(settledAgain.held.get("p"), 1_000 + HANDOFF_MS, "the first wake's short turn ends; the report's wake is still to come");
});

test("a subthread that reports back ending is a wait ending for its parent", () => {
  const kid = (overrides: Partial<PluginSidebarThread>) => thread("kid", { parentThreadId: "p", ...overrides });
  const ended = run([thread("p", DONE), kid(WORKING)], [thread("p", DONE), kid(DONE)]);
  assert.deepEqual([...ended.held.keys()], ["p"]);
});

test("a hold lasts through quiet updates, then ends at its time", () => {
  const settled = [thread("p", DONE)];
  const held = run([thread("p", WAITING)], settled, settled);
  assert.equal(held.held.get("p"), 1_000 + HANDOFF_MS, "a later quiet update keeps the first hold, never renews it");
  assert.equal(nextRelease(held), 1_000 + HANDOFF_MS);
  const released = nextHandoffs(held, settled, 1_000 + HANDOFF_MS);
  assert.equal(released.held.size, 0);
  assert.equal(nextRelease(released), null);
});

test("a turn that simply ends is never held; a wait that ends asking for you or failing drops the hold", () => {
  const plain = run([thread("p", WORKING)], [thread("p", DONE)]);
  assert.equal(plain.held.size, 0, "working to done is a real finish");
  const asks = run([thread("p", WAITING)], [thread("p", { indicator: "waiting-for-input" })]);
  assert.equal(asks.held.size, 0);
  const fails = run([thread("p", WAITING)], [thread("p", DONE)], [thread("p", { indicator: "unread-error" })]);
  assert.equal(fails.held.size, 0);
});

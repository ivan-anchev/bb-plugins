import assert from "node:assert/strict";
import { test } from "node:test";
import { threadState } from "./thread-state.ts";

test("a thread's value is kept across reads; one never set reads the initial value", () => {
  const store = threadState("initial", 2);
  store.set("thr_a", "toggled");
  for (let i = 0; i < 5; i++) assert.equal(store.get("thr_a"), "toggled", "reading, as a remount or tab switch does, evicts nothing");
  assert.equal(store.get("thr_b"), "initial");
});

test("past `keep` threads, the least recently set one is dropped and reads the initial value again", () => {
  const store = threadState("initial", 2);
  store.set("thr_a", "a");
  store.set("thr_b", "b");
  store.set("thr_a", "a2"); // set again: now the newest
  store.set("thr_c", "c");
  assert.deepEqual(["thr_a", "thr_b", "thr_c"].map((id) => store.get(id)), ["a2", "initial", "c"]);
});

test("every set notifies subscribers until they leave", () => {
  const store = threadState(0, 2);
  let calls = 0;
  const leave = store.subscribe(() => calls++);
  store.set("thr_a", 1);
  leave();
  store.set("thr_a", 2);
  assert.equal(calls, 1);
});

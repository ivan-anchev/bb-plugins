import assert from "node:assert/strict";
import { test } from "node:test";
import type { MergedPr } from "../contract.ts";
import { createSnapshot, type SnapshotDeps } from "./snapshot.ts";

const NOW = new Date(2026, 10, 13, 12).getTime();
const PR: MergedPr = { mergedAt: NOW - 86_400_000, lines: 12 };

function harness(overrides: Partial<SnapshotDeps> = {}) {
  const store = new Map<string, unknown>();
  const calls = { github: 0, refreshed: 0 };
  const deps: SnapshotDeps = {
    kv: { get: async <T,>(k: string) => store.get(k) as T | undefined, set: async (k, v) => void store.set(k, v) },
    readMergedPrs: async () => (calls.github++, [PR]),
    readThreadStarts: async () => [NOW - 1000],
    describeFailure: () => "gh is not signed in",
    onRefreshed: () => void calls.refreshed++,
    warn: () => {},
    now: () => NOW,
    ...overrides,
  };
  return { snapshot: createSnapshot(deps), calls };
}

test("the first read builds a snapshot; later reads come from storage without GitHub", async () => {
  const { snapshot, calls } = harness();
  assert.deepEqual(await snapshot.read(), { prs: [PR], threadStarts: [NOW - 1000], problem: null });
  await snapshot.read();
  assert.equal(calls.github, 1);
});

test("refreshes running at once share one GitHub read and one card update", async () => {
  const { snapshot, calls } = harness();
  await Promise.all([snapshot.refresh(), snapshot.refresh(), snapshot.read()]);
  assert.equal(calls.github, 1);
  assert.equal(calls.refreshed, 1);
});

test("a failed GitHub read keeps the last PRs and shows no problem", async () => {
  let fail = false;
  const { snapshot } = harness({ readMergedPrs: async () => (fail ? Promise.reject(new Error("offline")) : [PR]) });
  await snapshot.refresh();
  fail = true;
  assert.deepEqual((await snapshot.refresh()).prs, [PR]);
  assert.equal((await snapshot.read()).problem, null);
});

test("with no PRs ever read, a failure becomes the card's problem line", async () => {
  const { snapshot } = harness({ readMergedPrs: () => Promise.reject(new Error("401")) });
  assert.deepEqual(await snapshot.read(), { prs: null, threadStarts: [NOW - 1000], problem: "gh is not signed in" });
});

test("asks GitHub from a week before the grid's first Monday", async () => {
  let since = "";
  const { snapshot } = harness({ readMergedPrs: async (s) => ((since = s), []) });
  await snapshot.refresh();
  assert.equal(since, "2026-05-11"); // grid starts Mon May 18 for Fri Nov 13
});

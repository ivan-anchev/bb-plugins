import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { buildActivity, type RowModel } from "./activity.ts";
import { project, thread } from "./fixtures.ts";
import type { SleepRecord } from "../contract.ts";
import { sleepItem, type SleepHandlers } from "./sleep-action.ts";

// why: Sleep's times read the local clock; one zone keeps them the same on every machine.
process.env.TZ = "America/New_York";

/** Thursday 12 November 2026, 2:15 PM in New York. */
const NOW = new Date(2026, 10, 12, 14, 15).getTime();
const HOUR = 3_600_000;

/** The one row a thread makes, as the list builds it, with its sleep if any. */
function rowOf(t: PluginSidebarThread, sleep: SleepRecord | null = null): RowModel {
  const sleeps = new Map(sleep === null ? [] : [[t.id, sleep]]);
  const sections = buildActivity({ threads: [t], projects: [project("prj_a", "bb-plugins")], sleeps, now: NOW, activeThreadId: null, filter: null }).sections;
  const row = sections.flatMap((s) => s.rows)[0];
  assert.ok(row);
  return row;
}

const NO_OWN: SleepHandlers = { sleep() {}, wake() {}, sleepCustom() {} };

const TIMES = ["In 1 hour · 3:15 PM", "In 3 hours · 5:15 PM", "This evening · 6:00 PM", "Tomorrow · 9:00 AM", "Next week · Mon 9:00 AM", "Custom…"];

test("an idle row adds Sleep ▸ with Zeron's times and Custom… to bb's menu", () => {
  const item = sleepItem(rowOf(thread("a")), NO_OWN, NOW);
  assert.equal(item?.action.label, "Sleep");
  assert.deepEqual(item?.action.choices?.items.map((c) => c.label), TIMES);
});

test("each time sleeps the thread until it; Custom… opens the dialog", async () => {
  const own: string[] = [];
  const item = sleepItem(rowOf(thread("a")), { ...NO_OWN, sleep: (until) => own.push(`sleep ${until}`), sleepCustom: () => own.push("custom") }, NOW);
  for (const c of item?.action.choices?.items ?? []) await item?.action.run({ value: c.id, requestRename() {} });
  const monday = new Date(2026, 10, 16, 9).getTime();
  const sleeps = [NOW + HOUR, NOW + 3 * HOUR, new Date(2026, 10, 12, 18).getTime(), new Date(2026, 10, 13, 9).getTime(), monday].map((t) => `sleep ${t}`);
  assert.deepEqual(own, [...sleeps, "custom"]);
});

test("pinned and archived rows add nothing", () => {
  assert.equal(sleepItem(rowOf(thread("a", { isPinned: true, pinnedAt: 1 })), NO_OWN, NOW), null);
  assert.equal(sleepItem(rowOf(thread("a", { isArchived: true, archivedAt: 1 })), NO_OWN, NOW), null);
});

test("an asleep row adds Wake in Sleep's place, which wakes it", async () => {
  let woke = 0;
  const item = sleepItem(rowOf(thread("a"), { threadId: "a", until: NOW + HOUR }), { ...NO_OWN, wake: () => woke++ }, NOW);
  assert.equal(item?.action.label, "Wake");
  await item?.action.run({ requestRename() {} });
  assert.equal(woke, 1);
});

test("a row that woke, or that woke early asking for you, offers Sleep again", () => {
  const woke = sleepItem(rowOf(thread("a"), { threadId: "a", until: NOW - 1 }), NO_OWN, NOW);
  const asking = sleepItem(rowOf(thread("a", { indicator: "waiting-for-input" }), { threadId: "a", until: NOW + HOUR }), NO_OWN, NOW);
  for (const item of [woke, asking]) assert.equal(item?.action.label, "Sleep");
});

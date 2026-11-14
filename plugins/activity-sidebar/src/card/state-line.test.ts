import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { RowModel } from "../model/activity.ts";
import { thread, WORKING } from "../model/fixtures.ts";
import { stateLine } from "./state-line.ts";
import { underWaySince } from "./under-way.ts";

// why: "wakes at" reads the local clock; one zone keeps it the same on every machine.
process.env.TZ = "America/New_York";

const MINUTE = 60_000;
/** Friday 13 November 2026, 2:00 PM in New York. */
const NOW = new Date(2026, 10, 13, 14, 0).getTime();
const TOMORROW_9 = new Date(2026, 10, 14, 9, 0).getTime();

function row(t: PluginSidebarThread, asleepUntil: number | null = null): RowModel {
  return { thread: t, corner: { kind: "time", text: "" }, strong: false, current: false, runningUnder: 0, project: { name: "bb-plugins", hue: "blue" }, detail: { machine: null, branch: null }, asleepUntil };
}

test("under way: its state, and for how long since the list first saw it so", () => {
  const r = row(thread("w", WORKING));
  assert.deepEqual(stateLine(r, "working", NOW - 4 * MINUTE, NOW), { glyph: { kind: "state", state: "working" }, lead: "Working", note: "for 4m" });
  assert.equal(stateLine(r, "waiting", NOW - 10_000, NOW).note, "for under a minute");
});

test("in another state: its state, and how long ago it last moved", () => {
  const r = row(thread("d", { indicator: "unread-success", latestAttentionAt: NOW - 5 * MINUTE }));
  assert.deepEqual(stateLine(r, "done", 0, NOW), { glyph: { kind: "state", state: "done" }, lead: "Completed", note: "5m ago" });
  const fresh = row(thread("d", { latestAttentionAt: NOW - 20_000 }));
  assert.equal(stateLine(fresh, "approval", 0, NOW).note, "just now");
});

test("asleep: when it wakes; asleep and working, both", () => {
  assert.deepEqual(stateLine(row(thread("s"), TOMORROW_9), null, 0, NOW), { glyph: { kind: "asleep" }, lead: "Asleep", note: "wakes at 9:00 AM" });
  assert.equal(stateLine(row(thread("s", WORKING), TOMORROW_9), "working", NOW - 2 * MINUTE, NOW).note, "for 2m · wakes at 9:00 AM");
});

test("in no state: how long ago it moved; archived, how long ago it was archived", () => {
  assert.deepEqual(stateLine(row(thread("q", { latestAttentionAt: NOW - 3 * 3_600_000 })), null, 0, NOW), { glyph: { kind: "clock" }, lead: "3h ago", note: null });
  const archived = thread("x", { isArchived: true, archivedAt: NOW - 2 * MINUTE, latestAttentionAt: 0 });
  assert.equal(stateLine(row(archived), null, 0, NOW).lead, "2m ago");
});

test("underWaySince keeps the first sighting while it stays under way and forgets it once it stops", () => {
  const first = underWaySince(new Map(), [thread("w", { ...WORKING, updatedAt: 100 }), thread("idle", { updatedAt: 50 })]);
  assert.deepEqual([...first], [["w", 100]]);
  // Read while it works: updatedAt moves, the sighting holds.
  const read = underWaySince(first, [thread("w", { ...WORKING, updatedAt: 900 })]);
  assert.deepEqual([...read], [["w", 100]]);
  const stopped = underWaySince(read, [thread("w", { updatedAt: 950 })]);
  assert.deepEqual([...stopped], []);
  const again = underWaySince(stopped, [thread("w", { ...WORKING, updatedAt: 1000 })]);
  assert.deepEqual([...again], [["w", 1000]], "a new turn starts afresh");
});

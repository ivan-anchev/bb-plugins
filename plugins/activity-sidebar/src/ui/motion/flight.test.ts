import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { layout, quiet, SHOWN } from "../../list/fixtures.ts";
import type { Layout } from "../../list/layout.ts";
import { STILL } from "../../list/motion-plan.ts";
import { thread, WORKING } from "../../model/fixtures.ts";
import { atRest, landed, passing, settled, takeOff } from "./flight.ts";

const y = (l: Layout, key: string) => l.entries.find((e) => e.key === key)!.y;
const working = (id: string) => (t: PluginSidebarThread) => (t.id === id ? { ...t, ...WORKING } : t);
const archived = (ids: readonly string[]) => (t: PluginSidebarThread) => (ids.includes(t.id) ? { ...t, isArchived: true, archivedAt: 5 } : t);

/** The top of a list longer than its 300px sidebar: the view shows its first 100px, and what lies within 260 of its top is mounted. */
const TOP = { top: 0, height: 100 };
const long = (threads: readonly PluginSidebarThread[]) => layout(threads, SHOWN, 300);

test("a gliding row is mounted wherever the view meets its way, from where it starts to where it lands", () => {
  const before = long(quiet(14));
  const after = long(quiet(14, working("a0")));
  assert.deepEqual([y(before, "s:a0"), y(after, "s:a0")], [30, 474]);
  const gliding = takeOff(atRest(before), after, TOP);
  const passes = (top: number) => passing(gliding, { top, height: 100 }).includes("s:a0");
  assert.deepEqual([passes(0), passes(200), passes(450), passes(700)], [true, true, true, false]);
});

test("a glide cut short by the next change keeps its row mounted wherever the first glide can still carry it", () => {
  const gliding = takeOff(atRest(long(quiet(14))), long(quiet(14, working("a0"))), TOP);
  // A new row tops Activity mid-glide: Working, where the row is headed, moves 32 further down.
  const pushed = takeOff(gliding, long([thread("new", { latestAttentionAt: 500 }), ...quiet(14, working("a0"))]), TOP);
  assert.equal(y(pushed.layout, "s:a0"), 506);
  assert.ok(passing(pushed, TOP).includes("s:a0"));
  // The first glide is what keeps it: once it lands, the row's 32px slide far below is all that is left.
  assert.ok(!passing(landed(pushed, gliding.plan), TOP).includes("s:a0"));
});

test("a plan landing ends its own moves and ghosts; a later plan's play on", () => {
  const first = takeOff(atRest(layout(quiet(5))), layout(quiet(5, working("a1"))), TOP);
  const second = takeOff(first, layout(quiet(5, archived(["a3"]))), TOP);
  const left = landed(second, first.plan);
  assert.deepEqual(left.moving, second.plan.moves);
  assert.deepEqual(left.ghosts, second.plan.ghosts);
  assert.equal(left.ghosts.length, 1);
});

test("a leaver's ghost is chosen as its plan starts: drawn only when the view can show it closing", () => {
  // Scrolled to the end of 30 rows; one near the top goes, one a screen up, and the last ten. The list
  // closes up by 384, so the browser drops the view that far, carrying everything down with it.
  const before = long(quiet(30));
  const end = { top: before.height - 300, height: 300 };
  const gone = ["a2", "a12", ...Array.from({ length: 10 }, (_, i) => `a${20 + i}`)];
  const flight = takeOff(atRest(before), long(quiet(30, archived(gone))), end);
  assert.equal(flight.drop, 384);
  assert.equal(flight.plan.ghosts.length, 12);
  const drawn = flight.ghosts.map((g) => g.entry.key);
  assert.ok(!drawn.includes("s:a2"), "never in view, so never drawn: mounted later, it would stand there whole");
  assert.ok(drawn.includes("s:a12"), "above the view, but the drop brings it in");
  assert.ok(gone.slice(2).every((id) => drawn.includes(`s:${id}`)));
});

test("Reduce motion settles what is under way at once, and leaves a settled flight as it is", () => {
  const before = layout(quiet(5));
  const after = layout(quiet(5, archived(["a3"])));
  const flying = takeOff(atRest(before), after, TOP);
  assert.ok(flying.moving.length > 0 && flying.ghosts.length > 0);
  const still = settled(flying, after);
  assert.deepEqual(still, { layout: after, plan: STILL, drop: 0, moving: [], ghosts: [] });
  assert.equal(settled(still, after), still);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread, WORKING } from "../model/fixtures.ts";
import { layout, quiet, SHOWN, view } from "./fixtures.ts";
import { listItems } from "./items.ts";
import { layoutItems, type Layout } from "./layout.ts";
import { EASE, glideMs, OUT3, planMotion, STILL } from "./motion-plan.ts";

const y = (l: Layout, key: string) => l.entries.find((e) => e.key === key)!.y;
const moveOf = (plan: ReturnType<typeof planMotion>, key: string) => plan.moves.find((m) => m.key === key)?.segments;

test("a glide takes 180 up to the sidebar's 256, longer by the square root of the distance, to at most 240", () => {
  assert.equal(glideMs(0), 180);
  assert.equal(glideMs(32), 180);
  assert.equal(glideMs(-256), 180);
  assert.equal(glideMs(400), 225); // 180 × √(400 / 256)
  assert.equal(Math.round(glideMs(455)), 240);
  assert.equal(glideMs(-3000), 240);
});

test("a thread starting work glides into Working while the rows below it glide up to close the gap", () => {
  const before = layout(quiet(5));
  const after = layout(quiet(5, (t) => (t.id === "a1" ? { ...t, ...WORKING } : t)));
  const plan = planMotion(before, after);

  const travel = y(before, "s:a1") - y(after, "s:a1");
  assert.ok(travel < -400, `a long way down: ${travel}`);
  assert.deepEqual(moveOf(plan, "s:a1"), [{ from: travel, timing: { ms: glideMs(travel), delay: 0, easing: EASE } }]);
  for (const key of ["s:a2", "s:a3", "s:a4"]) assert.deepEqual(moveOf(plan, key), [{ from: 32, timing: { ms: 180, delay: 0, easing: EASE } }]);
  assert.equal(moveOf(plan, "s:a0"), undefined, "above it, nothing moves");
  assert.equal(moveOf(plan, "t:working"), undefined, "a new title stands where it lands");
  assert.deepEqual([plan.arrivals, plan.ghosts], [[], []]);
});

test("finishing, it glides back to the top past the rows it pushes down", () => {
  const working = layout(quiet(5, (t) => (t.id === "a1" ? { ...t, ...WORKING } : t)));
  const done = layout(quiet(5, (t) => (t.id === "a1" ? { ...t, latestAttentionAt: 200, isUnread: true } : t)));
  const plan = planMotion(working, done);

  const travel = y(working, "s:a1") - y(done, "s:a1");
  assert.deepEqual(moveOf(plan, "s:a1"), [{ from: travel, timing: { ms: glideMs(travel), delay: 0, easing: EASE } }]);
  assert.deepEqual(moveOf(plan, "s:a0"), [{ from: -32, timing: { ms: 180, delay: 0, easing: EASE } }]);
});

test("an arriving row opens over 260 on out(3) and fades in over 160 while the rows below slide down for it", () => {
  const before = layout(quiet(3, (t) => (t.id === "a0" ? { ...t, isArchived: true, archivedAt: 5 } : t)));
  const after = layout(quiet(3));
  const plan = planMotion(before, after);

  assert.deepEqual(plan.arrivals, [
    { key: "s:a0", reveal: { ms: 260, delay: 0, easing: OUT3 }, window: [0, 1], fade: { ms: 160, delay: 0, easing: EASE } },
  ]);
  for (const key of ["s:a1", "s:a2"]) assert.deepEqual(moveOf(plan, key), [{ from: -32, timing: { ms: 260, delay: 0, easing: OUT3 } }]);
  assert.equal(moveOf(plan, "s:a0"), undefined, "it opens where it lands");
  assert.equal(moveOf(plan, "t:archived"), undefined, "the spacer gives the room: the foot stands");
});

test("a leaving row stays where it stood, closing over 260 and fading over 160, while the rows below slide up", () => {
  const before = layout(quiet(4));
  const after = layout(quiet(4, (t) => (t.id === "a1" ? { ...t, isArchived: true, archivedAt: 5 } : t)));
  const plan = planMotion(before, after);

  assert.equal(plan.ghosts.length, 1);
  const [ghost] = plan.ghosts;
  assert.deepEqual([ghost.entry.key, ghost.entry.y, ghost.entry.h], ["s:a1", y(before, "s:a1"), 30]);
  assert.deepEqual([ghost.collapse, ghost.fade], [{ ms: 260, delay: 0, easing: OUT3 }, { ms: 160, delay: 0, easing: EASE }]);
  for (const key of ["s:a2", "s:a3"]) assert.deepEqual(moveOf(plan, key), [{ from: 32, timing: { ms: 260, delay: 0, easing: OUT3 } }]);
  assert.equal(moveOf(plan, "s:a0"), undefined);
});

test("rows arriving together each open on their own, so the later ones slide down as the earlier ones open", () => {
  const archived = (id: string) => (t: PluginSidebarThread) => (t.id === id ? { ...t, isArchived: true, archivedAt: 5 } : t);
  const before = layout(quiet(3, (t) => archived("a1")(archived("a0")(t))));
  const plan = planMotion(before, layout(quiet(3)));
  assert.deepEqual(plan.arrivals.map((a) => [a.key, a.window]), [["s:a0", [0, 1]], ["s:a1", [0, 1]]]);
  assert.equal(moveOf(plan, "s:a0"), undefined);
  assert.deepEqual(moveOf(plan, "s:a1"), [{ from: -32, timing: { ms: 260, delay: 0, easing: OUT3 } }]);
});

test("a row gone with its whole section leaves no ghost: there is no section left to close in", () => {
  const before = layout(quiet(2, (t) => (t.id === "a1" ? { ...t, ...WORKING } : t)));
  const after = layout(quiet(2, (t) => (t.id === "a1" ? { ...t, ...WORKING, isArchived: true, archivedAt: 5 } : t)));
  assert.deepEqual(planMotion(before, after).ghosts, []);
});

test("unfolding, a section's rows open as one over 260 and fade in over 180 after 140, and the rest slide on its timing", () => {
  const threads = quiet(2).concat([1, 2, 3].map((i) => thread(`w${i}`, { ...WORKING, latestAttentionAt: 10 - i })));
  const folded = layout(threads, ["activity"]);
  const open = layout(threads, ["activity", "working"]);
  const plan = planMotion(folded, open);

  const reveal = { ms: 260, delay: 0, easing: EASE };
  const fade = { ms: 180, delay: 140, easing: EASE };
  // three rows of 30 with gaps of 2: 94 tall; the fold's edge crosses each in turn
  assert.deepEqual(plan.arrivals, [
    { key: "s:w1", reveal, fade, window: [0, 30 / 94] },
    { key: "s:w2", reveal, fade, window: [32 / 94, 62 / 94] },
    { key: "s:w3", reveal, fade, window: [64 / 94, 1] },
  ]);
  assert.deepEqual(moveOf(plan, "t:working"), [{ from: 96, timing: reveal }], "the spacer gives up the room: Working's title rides up");
  for (const key of ["s:w1", "s:w2", "s:w3"]) assert.deepEqual(moveOf(plan, key), [{ from: 96, timing: reveal }], `${key} rides up under it`);
});

test("folding, a section's rows fade out over 90, then it closes over 240 while the rest slide", () => {
  const threads = quiet(2).concat([1, 2, 3].map((i) => thread(`w${i}`, { ...WORKING, latestAttentionAt: 10 - i })));
  const open = layout(threads, ["activity", "working"]);
  const folded = layout(threads, ["activity"]);
  const plan = planMotion(open, folded);

  assert.deepEqual(
    plan.ghosts.map((g) => [g.entry.key, g.entry.y]),
    ["s:w1", "s:w2", "s:w3"].map((key) => [key, y(open, key)]),
  );
  for (const g of plan.ghosts) assert.deepEqual([g.fade, g.collapse], [{ ms: 90, delay: 0, easing: EASE }, { ms: 240, delay: 90, easing: EASE }]);
  assert.deepEqual(moveOf(plan, "t:working"), [{ from: -96, timing: { ms: 240, delay: 90, easing: EASE } }]);
});

test("a fold animates only its own section: a row arriving elsewhere at the same time just stands there", () => {
  const working = [1, 2].map((i) => thread(`w${i}`, { ...WORKING, latestAttentionAt: 10 - i }));
  const before = layout(quiet(2).concat(working), ["activity"]);
  const after = layout(quiet(2).concat(working, thread("new", { latestAttentionAt: 500 })), ["activity", "working"]);
  assert.deepEqual(
    planMotion(before, after).arrivals.map((a) => a.key),
    ["s:w1", "s:w2"],
  );
});

test("a resize, the first rows after loading and an unchanged list move nothing", () => {
  const threads = quiet(3);
  assert.equal(planMotion(layout(threads, SHOWN, 800), layout(threads, SHOWN, 600)), STILL);
  const loading = layoutItems(listItems([], view({ status: "loading" })), 800);
  assert.equal(planMotion(loading, layout(threads)), STILL);
  assert.equal(planMotion(layout(threads), layout(threads)), STILL);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActivity } from "../model/activity.ts";
import { thread } from "../model/fixtures.ts";
import { view } from "./fixtures.ts";
import { listItems, type ListItem } from "./items.ts";
import { layoutItems, METRICS, visibleKeys } from "./layout.ts";

const title = (key: "pinned" | "activity"): ListItem => ({ kind: "title", key: `t:${key}`, section: key, label: key, open: true, count: null });
const notice: ListItem = { kind: "notice", key: "n:list", text: "Loading threads…", retry: false };
const spacer: ListItem = { kind: "spacer", key: "spacer" };

/** n rows keyed s:t0 … s:t{n-1}, top to bottom. */
function rows(n: number): ListItem[] {
  const threads = Array.from({ length: n }, (_, i) => thread(`t${i}`, { latestAttentionAt: n - i }));
  const sections = buildActivity({ threads, projects: [], sleeps: new Map(), held: new Set(), now: 0, activeThreadId: null, filter: null }).sections;
  return listItems(sections, view()).filter((item) => item.kind === "row");
}

test("titles are 24, rows 30, with the gap between and the padding around", () => {
  const layout = layoutItems([title("activity"), notice, notice], 0);
  assert.deepEqual(
    layout.entries.map((e) => [e.y, e.h]),
    [
      [4, 24],
      [30, 30],
      [62, 30],
    ],
  );
  assert.equal(layout.height, 62 + 30 + METRICS.padBottom);
});

test("a spacer takes the room the rest leave, so what follows it stands at the foot", () => {
  const layout = layoutItems([title("activity"), spacer, title("pinned")], 400);
  const [, gap, foot] = layout.entries;
  // 400 - 4 top - 8 bottom - 24 - 24 - 2 gaps of 2 = 336
  assert.equal(gap.h, 336);
  assert.equal(foot.y + foot.h + METRICS.padBottom, 400);
  assert.equal(layout.height, 400);
});

test("a spacer collapses to nothing when the list overflows", () => {
  const layout = layoutItems([title("activity"), spacer, title("pinned")], 10);
  assert.equal(layout.entries[1].h, 0);
});

test("the content is never shorter than the viewport", () => {
  assert.equal(layoutItems([title("activity")], 500).height, 500);
});

test("visibleKeys finds the window at the top, the middle and the bottom", () => {
  const layout = layoutItems(rows(1000), 320); // row i stands at y = 4 + 32i
  const at = (top: number) => visibleKeys(layout, top, 320, 0);

  assert.deepEqual(at(0), keys(0, 10)); // 0..320 holds rows 0..9 (row 10 starts at 324)
  assert.deepEqual(at(3_200), keys(99, 110)); // row 99 ends at 3202; row 110 starts at 3524
  assert.deepEqual(at(layout.height - 320), keys(990, 1000)); // the last 320 of 32010: rows 990 (ends 31714) .. 999
});

test("overscan widens the window on both sides", () => {
  const layout = layoutItems(rows(1000), 320);
  assert.deepEqual(visibleKeys(layout, 3_200, 320, 64), keys(97, 112));
});

function keys(from: number, to: number): string[] {
  return Array.from({ length: to - from }, (_, i) => `s:t${from + i}`);
}

test("a tall row is 46, and the rows after it stand lower by the difference", () => {
  const [a, b] = rows(2).map((item) => (item.kind === "row" ? { ...item, tall: true } : item));
  const layout = layoutItems([title("activity"), a, b], 0);
  assert.deepEqual(
    layout.entries.map((e) => [e.y, e.h]),
    [
      [4, 24],
      [30, 46],
      [78, 46],
    ],
  );
});

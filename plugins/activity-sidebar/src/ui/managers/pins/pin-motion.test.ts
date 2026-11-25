import assert from "node:assert/strict";
import { test } from "node:test";
import { planPinMotion, type Placed } from "./pin-motion.ts";

const row = (y: number): Placed => ({ where: "list", box: { x: 8, y, w: 300, h: 46 }, face: { x: 16, y: y + 5, w: 36, h: 36 } });
const tile = (x: number, y: number): Placed => ({ where: "grid", box: { x, y, w: 100, h: 83 }, face: { x: x + 28, y: y + 8, w: 44, h: 44 } });

test("pinning: the avatar flies from its row to its tile, growing; the rows below it slide to their new places", () => {
  const before = new Map([
    ["a", row(4)],
    ["b", row(52)],
    ["c", row(100)],
  ]);
  const after = new Map([
    ["b", tile(8, 4)],
    ["a", row(99)],
    ["c", row(147)],
  ]);
  assert.deepEqual(planPinMotion(before, after), [
    { kind: "fly", key: "b", dx: 16 - 36, dy: 57 - 12, scale: 36 / 44 },
    { kind: "slide", key: "a", dx: 0, dy: 4 - 99 },
    { kind: "slide", key: "c", dx: 0, dy: 100 - 147 },
  ]);
});

test("unpinning: the avatar flies back down, shrinking; the tiles after it close up, and what stood still stays", () => {
  const before = new Map([
    ["p", tile(8, 4)],
    ["q", tile(110, 4)],
    ["a", row(99)],
  ]);
  const after = new Map([
    ["q", tile(8, 4)],
    ["a", row(99)],
    ["p", row(147)],
  ]);
  assert.deepEqual(planPinMotion(before, after), [
    { kind: "slide", key: "q", dx: 102, dy: 0 },
    { kind: "fly", key: "p", dx: 36 - 16, dy: 12 - 152, scale: 44 / 36 },
  ]);
});

test("nothing crossing, nothing moves: a manager arriving, leaving or a resize changes the view at once", () => {
  const before = new Map([["a", row(4)]]);
  assert.deepEqual(planPinMotion(before, new Map([["a", row(52)], ["new", row(4)]])), []);
  assert.deepEqual(planPinMotion(before, new Map()), []);
});

test("a newcomer in the same change as a pin fades in", () => {
  const before = new Map([["a", row(4)]]);
  assert.deepEqual(planPinMotion(before, new Map([["a", tile(8, 4)], ["new", row(99)]])), [
    { kind: "fly", key: "a", dx: -20, dy: -3, scale: 36 / 44 },
    { kind: "arrive", key: "new" },
  ]);
});

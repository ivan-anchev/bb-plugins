import assert from "node:assert/strict";
import { test } from "node:test";
import { ringDashes } from "./ring.ts";

/** Eight even dashes, 21.9° each, centred on the eighths from 12 o'clock: Zeron's glyph exactly. */
const STILL = Array.from({ length: 8 }, (_, i) => ({ from: 45 * i - 10.95, to: 45 * i + 10.95, lift: 0 }));

const round = (dashes: ReturnType<typeof ringDashes>) => dashes.map((d) => ({ from: +d.from.toFixed(6), to: +d.to.toFixed(6), lift: +d.lift.toFixed(6) }));

test("the still ring is eight even dashes, whatever the time", () => {
  for (const ms of [0, 1200, 3000, 4500]) assert.deepEqual(round(ringDashes(ms, true)), STILL);
});

test("the run starts and ends on the still frame, and the 900 ms rest holds it", () => {
  for (const ms of [0, 3900, 4200, 4799]) assert.deepEqual(round(ringDashes(ms, false)), STILL, `at ${ms} ms`);
});

test("mid-run the dashes near the lead stretch, lean and lift; none passes 60%", () => {
  const dashes = ringDashes(1950, false);
  const lengths = dashes.map((d) => d.to - d.from);
  assert.ok(Math.max(...lengths) > 21.9 * 1.5, `the longest stretches: ${Math.max(...lengths)}`);
  assert.ok(Math.min(...lengths) < 21.95, "the far side stays even");
  assert.ok(dashes.every((d) => d.lift >= 0 && d.lift <= 0.6));
  assert.ok(dashes.some((d) => d.lift > 0.3));
});

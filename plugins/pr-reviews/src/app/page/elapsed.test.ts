import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsedLabel } from "./elapsed.ts";

const cases: [ms: number, label: string][] = [
  [0, "0:00"],
  [999, "0:00"],
  [9_000, "0:09"],
  [252_000, "4:12"],
  [3_725_000, "62:05"],
  [-5_000, "0:00"],
];

for (const [ms, label] of cases) {
  test(`${ms} ms reads ${label}`, () => {
    assert.equal(elapsedLabel(1_000_000, 1_000_000 + ms), label);
  });
}

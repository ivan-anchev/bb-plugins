import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hunkIdSchema } from "../../diff/diff-schema.ts";
import type { GuideStep } from "../../guide/guide-schema.ts";
import type { VisibleStep } from "../../guide/walkthrough.ts";
import { nextPosition, OVERVIEW, placeOf, previousPosition, resolvePosition, type Position } from "./walkthrough-position.ts";

const step = (title: string): GuideStep => ({ title, explanation: "…", forYou: null, hunks: [{ file: "a.ts", hunk: hunkIdSchema.parse("@@ -1,1 +1,1 @@"), collapsed: null }] });

// Three shown steps whose guide indexes are 0, 2 and 3: step 1 of the guide is not shown.
const STEPS: VisibleStep[] = [
  { index: 0, step: step("One refresh in flight") },
  { index: 2, step: step("Retry once") },
  { index: 3, step: step("Tests") },
];

const at = (index: number): Position => ({ kind: "step", index });

describe("placeOf", () => {
  test("the overview has no step", () => {
    assert.deepEqual(placeOf(STEPS, OVERVIEW), { kind: "overview", title: "What this PR does" });
  });

  test("the first step leads back to the overview", () => {
    assert.deepEqual(placeOf(STEPS, at(0)), { kind: "step", title: "One refresh in flight", step: STEPS[0], number: 1, previousTitle: "What this PR does", nextTitle: "Retry once" });
  });

  test("a middle step counts among the shown steps and names both neighbours", () => {
    assert.deepEqual(placeOf(STEPS, at(2)), { kind: "step", title: "Retry once", step: STEPS[1], number: 2, previousTitle: "One refresh in flight", nextTitle: "Tests" });
  });

  test("the last step has no next title: → returns to the overview", () => {
    assert.deepEqual(placeOf(STEPS, at(3)), { kind: "step", title: "Tests", step: STEPS[2], number: 3, previousTitle: "Retry once", nextTitle: null });
  });

  test("a one-step guide is first and last at once", () => {
    const only = STEPS.slice(0, 1);
    assert.deepEqual(placeOf(only, at(0)), { kind: "step", title: "One refresh in flight", step: only[0], number: 1, previousTitle: "What this PR does", nextTitle: null });
  });
});

describe("nextPosition", () => {
  test("starts the walkthrough from the overview", () => {
    assert.deepEqual(nextPosition(STEPS, OVERVIEW), at(0));
  });

  test("moves to the next shown step by its guide index", () => {
    assert.deepEqual(nextPosition(STEPS, at(0)), at(2));
  });

  test("wraps from the last step to the overview", () => {
    assert.deepEqual(nextPosition(STEPS, at(3)), OVERVIEW);
  });
});

describe("previousPosition", () => {
  test("moves to the previous shown step", () => {
    assert.deepEqual(previousPosition(STEPS, at(3)), at(2));
  });

  test("returns from the first step to the overview", () => {
    assert.deepEqual(previousPosition(STEPS, at(0)), OVERVIEW);
  });

  test("stays on the overview", () => {
    assert.deepEqual(previousPosition(STEPS, OVERVIEW), OVERVIEW);
  });
});

describe("resolvePosition", () => {
  test("keeps a step that is still shown", () => {
    assert.deepEqual(resolvePosition(STEPS, at(2)), at(2));
  });

  test("moves from a step no longer shown to the nearest earlier shown step", () => {
    assert.deepEqual(resolvePosition(STEPS, at(1)), at(0));
    assert.deepEqual(resolvePosition(STEPS.slice(0, 2), at(3)), at(2));
  });

  test("moves to the overview when no earlier step is shown", () => {
    assert.deepEqual(resolvePosition(STEPS.slice(1), at(0)), OVERVIEW);
    assert.deepEqual(resolvePosition([], at(3)), OVERVIEW);
  });

  test("keeps the overview", () => {
    assert.deepEqual(resolvePosition(STEPS, OVERVIEW), OVERVIEW);
  });
});

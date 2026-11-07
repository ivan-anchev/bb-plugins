// What the walkthrough shows for the reader's view options. Pure; the app calls it at render.
import { isTestOrMock } from "./change-kind.ts";
import type { Guide, GuideStep } from "./guide-schema.ts";

/** The switches in the header's view options. `showFindings` has no effect until findings render. */
export type ViewOptions = { showTests: boolean; showFindings: boolean };

/** A step as the walkthrough shows it, with its index in `guide.steps`. */
export type VisibleStep = { index: number; step: GuideStep };

/**
 * The steps the reader walks through. With tests hidden, test and mock hunks leave every step,
 * and a step left with no hunks leaves the walkthrough. Every count the reader sees is `.length`.
 */
export function visibleSteps(guide: Guide, options: ViewOptions): VisibleStep[] {
  return guide.steps.flatMap((step, index) => {
    const hunks = options.showTests ? step.hunks : step.hunks.filter((entry) => !isTestOrMock(entry.file));
    return hunks.length === 0 ? [] : [{ index, step: { ...step, hunks } }];
  });
}

/** Test and mock hunks across the steps (the validator keeps them out of `hidden`). */
export function testHunkCount(guide: Guide): number {
  return guide.steps.reduce((count, step) => count + step.hunks.filter((entry) => isTestOrMock(entry.file)).length, 0);
}

/** The test and mock hunks the switch is hiding right now. */
export function hiddenTestHunkCount(guide: Guide, options: ViewOptions): number {
  return options.showTests ? 0 : testHunkCount(guide);
}

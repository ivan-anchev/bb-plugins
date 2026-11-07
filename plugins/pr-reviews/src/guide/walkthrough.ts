// What the walkthrough shows for the reader's view options. Pure; the app calls it at render.
import { isTestOrMock } from "./change-kind.ts";
import type { Finding, Guide, GuideHunk, GuideStep } from "./guide-schema.ts";

/** The switches in the header's view options. */
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

/** A finding as the walkthrough shows it, with its index in `guide.findings`, which names it to the server. */
export type VisibleFinding = { index: number; finding: Finding };

/** Every finding while the findings switch is on, in submission order; none while it is off. */
export function visibleFindings(guide: Guide, options: ViewOptions): VisibleFinding[] {
  return options.showFindings ? guide.findings.map((finding, index) => ({ index, finding })) : [];
}

/** The findings on one hunk of a step. */
export function findingsOn(findings: VisibleFinding[], entry: GuideHunk): VisibleFinding[] {
  return findings.filter(({ finding }) => isOn(finding, entry));
}

/** The number, counted from 1 as the controller counts, of the shown step that holds the finding's hunk; null when its hunk is hidden or filtered out. */
export function stepNumberOfFinding(steps: VisibleStep[], finding: Finding): number | null {
  const at = steps.findIndex(({ step }) => step.hunks.some((entry) => isOn(finding, entry)));
  return at === -1 ? null : at + 1;
}

const isOn = (finding: Finding, entry: GuideHunk) => finding.file === entry.file && finding.hunk === entry.hunk;

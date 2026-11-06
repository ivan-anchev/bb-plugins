import assert from "node:assert/strict";
import { test } from "node:test";
import { hunkIdOf, WHOLE_FILE, type DiffFile, type Hunk } from "../diff/diff-schema.ts";
import type { SubmitReviewInput } from "./guide-schema.ts";
import { validateSubmission } from "./validate-submission.ts";

// A hunk from its lines; the counts follow from them, as git writes them.
function hunk(oldStart: number, newStart: number, lines: string[]): Hunk {
  const oldLines = lines.filter((line) => line[0] === " " || line[0] === "-").length;
  const newLines = lines.filter((line) => line[0] === " " || line[0] === "+").length;
  return { oldStart, oldLines, newStart, newLines, lines };
}

const modified = (path: string, hunks: Hunk[]): DiffFile => ({ path, previousPath: null, status: "modified", binary: false, hunks });
const repeat = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}line ${i}`);

const CLIENT = "src/auth/token-client.ts";
const CLIENT_TEST = "src/auth/token-client.test.ts";

// @@ -18,9 +18,19 @@: context 18-21, removed old 22-26, added new 22-36.
const REFRESH = hunk(18, 18, [...repeat(" ", 4), ...repeat("-", 5), ...repeat("+", 15)]);
// @@ -60,3 +70,4 @@: old 60-62, new 70-73.
const RETRY = hunk(60, 70, [" a", "+b", " c", " d"]);
// @@ -1,2 +1,3 @@
const TEST_CASE = hunk(1, 1, [" describe", "+  it", " })"]);
// @@ -3,1 +3,2 @@, which git prints as @@ -3 +3,2 @@.
const NOTE = hunk(3, 3, [" ## 0.2.0", "+- Single-flight refresh."]);

const FILES: DiffFile[] = [
  modified(CLIENT, [REFRESH, RETRY]),
  modified(CLIENT_TEST, [TEST_CASE]),
  modified("CHANGELOG.md", [NOTE]),
  { path: "logo.png", previousPath: null, status: "added", binary: true, hunks: [] },
];

const overview = { problem: "Parallel 401s each refreshed the token.", approach: "Refresh is single-flight." };

const complete: SubmitReviewInput = {
  overview,
  steps: [
    {
      title: "One refresh at a time",
      explanation: "The first 401 starts the refresh; the rest wait for it.",
      hunks: [
        { file: CLIENT, hunk: "@@ -18,9 +18,19 @@" },
        { file: CLIENT, hunk: "@@ -60,3 +70,4 @@", collapsed: "Retry plumbing." },
      ],
    },
    { title: "The test", explanation: "Three parallel calls, one refresh.", forYou: "Is one retry enough?", hunks: [{ file: CLIENT_TEST, hunk: "@@ -1,2 +1,3 @@" }] },
  ],
  hidden: [{ files: ["CHANGELOG.md", "logo.png"], reason: "Release note and asset." }],
  findings: [{ file: CLIENT, line: 29, priority: "p0", title: "Refresh error is swallowed", body: "A failed refresh leaves waiters hanging." }],
};

// Exactly one change to the complete guide.
const withSteps = (steps: SubmitReviewInput["steps"]): SubmitReviewInput => ({ ...complete, steps });
const withHidden = (hidden: SubmitReviewInput["hidden"]): SubmitReviewInput => ({ ...complete, hidden });
const withFindings = (findings: SubmitReviewInput["findings"]): SubmitReviewInput => ({ ...complete, findings });
const [refreshStep, testStep] = complete.steps;

const REJECTED =
  "submit_review was rejected and nothing was saved. Fix every problem below and call submit_review again with the whole guide. Do not drop a hunk to make a problem go away: put it in a step, or in hidden with a reason.";

function rejection(input: SubmitReviewInput, files = FILES): string {
  const result = validateSubmission(input, files);
  assert.equal(result.ok, false, "expected a rejection");
  return result.ok ? "" : result.message;
}

function guideOf(input: SubmitReviewInput, files = FILES) {
  const result = validateSubmission(input, files);
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.guide;
}

test("a complete guide is accepted, with refs resolved to hunk ids, nulls for what was left out, and side defaulted", () => {
  assert.deepEqual(guideOf(complete), {
    overview: { ...overview, behaviour: null },
    steps: [
      {
        title: "One refresh at a time",
        explanation: "The first 401 starts the refresh; the rest wait for it.",
        forYou: null,
        hunks: [
          { file: CLIENT, hunk: hunkIdOf(REFRESH), collapsed: null },
          { file: CLIENT, hunk: hunkIdOf(RETRY), collapsed: "Retry plumbing." },
        ],
      },
      { title: "The test", explanation: "Three parallel calls, one refresh.", forYou: "Is one retry enough?", hunks: [{ file: CLIENT_TEST, hunk: hunkIdOf(TEST_CASE), collapsed: null }] },
    ],
    hidden: [{ kind: "files", files: ["CHANGELOG.md", "logo.png"], reason: "Release note and asset." }],
    findings: [
      { file: CLIENT, line: 29, side: "new", hunk: hunkIdOf(REFRESH), priority: "p0", title: "Refresh error is swallowed", body: "A failed refresh leaves waiters hanging." },
    ],
  });
});

test("a missing hunk is named under Missing", () => {
  const input = withSteps([{ ...refreshStep, hunks: [refreshStep.hunks[0]] }, testStep]);
  assert.equal(
    rejection(input),
    `${REJECTED}

Missing: these hunks are in no step and not in hidden (1):
  - "src/auth/token-client.ts" @@ -60,3 +70,4 @@`,
  );
});

test("a hunk in a step and in hidden is listed more than once, with both places", () => {
  const input = withHidden([...complete.hidden, { file: CLIENT, hunk: "@@ -60,3 +70,4 @@", reason: "Plumbing." }]);
  assert.equal(
    rejection(input),
    `${REJECTED}

Listed more than once (1):
  - "src/auth/token-client.ts" @@ -60,3 +70,4 @@ (step 1, hidden)`,
  );
});

test("tests and mocks in hidden, as a hunk or as files, are sent back to a step", () => {
  const MOCK = "__mocks__/x.ts";
  const files = [...FILES, modified(MOCK, [TEST_CASE])];
  const input: SubmitReviewInput = {
    ...complete,
    steps: [refreshStep],
    hidden: [
      ...complete.hidden,
      { file: CLIENT_TEST, hunk: "@@ -1,2 +1,3 @@", reason: "Only a test." },
      { files: [MOCK], reason: "A mock." },
    ],
  };
  assert.equal(
    rejection(input, files),
    `${REJECTED}

Hidden tests and mocks: put them in a step (2):
  - "src/auth/token-client.test.ts" @@ -1,2 +1,3 @@
  - "__mocks__/x.ts" @@ -1,2 +1,3 @@`,
  );
});

test("a file that is not in the PR is an unknown file, wherever it is named", () => {
  const input: SubmitReviewInput = {
    ...withSteps([{ ...refreshStep, hunks: [...refreshStep.hunks, { file: "src/auth/session.ts", hunk: "@@ -1,1 +1,1 @@" }] }, testStep]),
    findings: [{ file: "src/auth/sessoin.ts", line: 3, priority: "p2", title: "Typo", body: "…" }],
  };
  assert.equal(
    rejection(input),
    `${REJECTED}

Unknown files (2):
  - "src/auth/session.ts" (in step 1): not a file in this PR
  - "src/auth/sessoin.ts" (in finding 1): not a file in this PR`,
  );
});

test("an unknown hunk lists the file's valid hunks, and the hunk it failed to place is missing", () => {
  const input = withSteps([{ ...refreshStep, hunks: [{ file: CLIENT, hunk: "@@ -19,9 +18,19 @@" }, refreshStep.hunks[1]] }, testStep]);
  assert.equal(
    rejection(input),
    `${REJECTED}

Missing: these hunks are in no step and not in hidden (1):
  - "src/auth/token-client.ts" @@ -18,9 +18,19 @@

Unknown hunks (1):
  - "src/auth/token-client.ts" "@@ -19,9 +18,19 @@" (in step 1): no such hunk. Its hunks are: @@ -18,9 +18,19 @@, @@ -60,3 +70,4 @@`,
  );
});

test("hidden files cover every hunk of each file", () => {
  const input: SubmitReviewInput = {
    ...complete,
    steps: [testStep],
    hidden: [{ files: [CLIENT, "CHANGELOG.md", "logo.png"], reason: "Covered by the test." }],
    findings: [],
  };
  assert.deepEqual(guideOf(input).hidden, [{ kind: "files", files: [CLIENT, "CHANGELOG.md", "logo.png"], reason: "Covered by the test." }]);

  const twice = { ...input, steps: [refreshStep, testStep] };
  assert.match(rejection(twice), /Listed more than once \(2\):\n {2}- "src\/auth\/token-client.ts" @@ -18,9 \+18,19 @@ \(step 1, hidden\)\n {2}- "src\/auth\/token-client.ts" @@ -60,3 \+70,4 @@ \(step 1, hidden\)$/);
});

test("a binary file is one unit, named whole file", () => {
  const input = withHidden([
    { files: ["CHANGELOG.md"], reason: "Release note." },
    { file: "logo.png", hunk: "whole file", reason: "An asset." },
  ]);
  assert.deepEqual(guideOf(input).hidden[1], { kind: "hunk", file: "logo.png", hunk: WHOLE_FILE, reason: "An asset." });

  const ranged = withHidden([
    { files: ["CHANGELOG.md"], reason: "Release note." },
    { file: "logo.png", hunk: "@@ -1 +1 @@", reason: "An asset." },
  ]);
  assert.equal(
    rejection(ranged),
    `${REJECTED}

Missing: these hunks are in no step and not in hidden (1):
  - "logo.png" whole file

Unknown hunks (1):
  - "logo.png" "@@ -1 +1 @@" (in hidden): no such hunk. Its hunks are: whole file`,
  );
});

test("a finding outside every hunk lists the file's line ranges on its side", () => {
  const input = withFindings([
    { file: CLIENT, line: 50, priority: "p1", title: "Between hunks", body: "…" },
    { file: CLIENT, line: 30, side: "old", priority: "p2", title: "Old side, past the removed lines", body: "…" },
    { file: "logo.png", line: 1, priority: "p2", title: "Binary", body: "…" },
  ]);
  assert.equal(
    rejection(input),
    `${REJECTED}

Findings outside the diff (3):
  - finding 1 ("src/auth/token-client.ts" line 50, new side): not inside any hunk. Its new-side lines in hunks: 18-36, 70-73
  - finding 2 ("src/auth/token-client.ts" line 30, old side): not inside any hunk. Its old-side lines in hunks: 18-26, 60-62
  - finding 3 ("logo.png" line 1, new side): not inside any hunk. Its hunks show no new-side lines.`,
  );
});

test("a finding on a removed line is placed on the old side", () => {
  const input = withFindings([{ file: CLIENT, line: 24, side: "old", priority: "p1", title: "Removed guard", body: "…" }]);
  assert.deepEqual(guideOf(input).findings.map(({ side, hunk }) => ({ side, hunk })), [{ side: "old", hunk: hunkIdOf(REFRESH) }]);
});

test("hunk refs are read tolerantly: no @@ marks, trailing context, and an omitted count", () => {
  for (const ref of ["-18,9 +18,19", "@@ -18,9 +18,19 @@ export class TokenClient {", "  @@ -18,9 +18,19 @@  "]) {
    const input = withSteps([{ ...refreshStep, hunks: [{ file: CLIENT, hunk: ref }, refreshStep.hunks[1]] }, testStep]);
    assert.equal(guideOf(input).steps[0].hunks[0].hunk, hunkIdOf(REFRESH), ref);
  }
  const note = withHidden([
    { file: "CHANGELOG.md", hunk: "@@ -3 +3,2 @@", reason: "Release note." },
    { files: ["logo.png"], reason: "An asset." },
  ]);
  assert.deepEqual(guideOf(note).hidden[0], { kind: "hunk", file: "CHANGELOG.md", hunk: hunkIdOf(NOTE), reason: "Release note." });
});

test("a ref whose count is wrong, or that is not a range, is unknown", () => {
  for (const ref of ["@@ -18,8 +18,19 @@", "@@ -17,9 +18,19 @@", "-18,9", "the refresh hunk"]) {
    const input = withSteps([{ ...refreshStep, hunks: [{ file: CLIENT, hunk: ref }, refreshStep.hunks[1]] }, testStep]);
    assert.match(rejection(input), /Unknown hunks \(1\)/, ref);
  }
});

test("paths in the message are written as in the hunk list, with hidden characters escaped", () => {
  const zeroWidth = `src/a${String.fromCharCode(0x200b)}.ts`;
  const files = [modified(zeroWidth, [TEST_CASE])];
  const input: SubmitReviewInput = { overview, steps: [{ ...testStep, hunks: [{ file: "src/a.ts", hunk: "@@ -1,2 +1,3 @@" }] }], hidden: [], findings: [] };
  const escaped = `"src/a${"\\"}u200B.ts"`;
  assert.equal(
    rejection(input, files),
    `${REJECTED}

Missing: these hunks are in no step and not in hidden (1):
  - ${escaped} @@ -1,2 +1,3 @@

Unknown files (1):
  - "src/a.ts" (in step 1): not a file in this PR`,
  );
  const exact = { ...input, steps: [{ ...testStep, hunks: [{ file: zeroWidth, hunk: "@@ -1,2 +1,3 @@" }] }] };
  assert.equal(validateSubmission(exact, files).ok, true);
});

test("each section lists at most 40 problems", () => {
  const files = Array.from({ length: 45 }, (_, i) => modified(`f${i}.ts`, [TEST_CASE]));
  const input: SubmitReviewInput = { overview, steps: [{ ...testStep, hunks: [{ file: "f0.ts", hunk: "@@ -1,2 +1,3 @@" }] }], hidden: [], findings: [] };
  const lines = rejection(input, files).split("\n");
  assert.equal(lines[2], "Missing: these hunks are in no step and not in hidden (44):");
  assert.equal(lines.filter((line) => line.startsWith("  - ")).length, 40);
  assert.equal(lines.at(-1), "  …and 4 more");
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hunkIdSchema } from "../diff/diff-schema.ts";
import type { Finding, Guide, GuideHunk, GuideStep } from "./guide-schema.ts";
import { findingsOn, hiddenTestHunkCount, stepNumberOfFinding, testHunkCount, visibleFindings, visibleSteps, type ViewOptions } from "./walkthrough.ts";

const entry = (file: string): GuideHunk => ({ file, hunk: hunkIdSchema.parse("@@ -1,1 +1,1 @@"), collapsed: null });
const step = (title: string, files: string[]): GuideStep => ({ title, explanation: "…", forYou: null, hunks: files.map(entry) });

// A mixed step, a code step, and a step of tests and mocks alone.
const MIXED = step("Refresh once", ["src/token-client.ts", "src/token-client.test.ts"]);
const CODE = step("Retry once", ["src/fetch.ts"]);
const TESTS = step("The tests", ["src/fetch.test.ts", "src/__mocks__/server.ts"]);

const guide: Guide = {
  overview: { problem: "…", approach: "…", behaviour: null },
  steps: [MIXED, CODE, TESTS],
  hidden: [{ kind: "files", files: ["CHANGELOG.md"], reason: "Release note." }],
  findings: [],
};

const SHOWN: ViewOptions = { showTests: true, showFindings: true };
const HIDDEN: ViewOptions = { showTests: false, showFindings: true };

describe("visibleSteps", () => {
  test("with tests shown, every step is shown whole, with its guide index", () => {
    assert.deepEqual(visibleSteps(guide, SHOWN), [
      { index: 0, step: MIXED },
      { index: 1, step: CODE },
      { index: 2, step: TESTS },
    ]);
  });

  test("with tests hidden, a mixed step keeps its other hunks and a tests-only step leaves", () => {
    assert.deepEqual(visibleSteps(guide, HIDDEN), [
      { index: 0, step: { ...MIXED, hunks: [entry("src/token-client.ts")] } },
      { index: 1, step: CODE },
    ]);
  });

  test("the count of shown steps follows the switch", () => {
    assert.equal(visibleSteps(guide, SHOWN).length, 3);
    assert.equal(visibleSteps(guide, HIDDEN).length, 2);
  });

  test("a guide of tests alone shows no steps while tests are hidden", () => {
    assert.deepEqual(visibleSteps({ ...guide, steps: [TESTS] }, HIDDEN), []);
  });

  test("generated files, docs and code stay shown", () => {
    const other = step("Other", ["package-lock.json", "docs/guide.md", "src/index.ts"]);
    assert.deepEqual(visibleSteps({ ...guide, steps: [other] }, HIDDEN), [{ index: 0, step: other }]);
  });
});

describe("hiddenTestHunkCount", () => {
  test("counts the test and mock hunks across steps while tests are hidden", () => {
    assert.equal(testHunkCount(guide), 3);
    assert.equal(hiddenTestHunkCount(guide, HIDDEN), 3);
  });

  test("is 0 while tests are shown, or when the guide has none", () => {
    assert.equal(hiddenTestHunkCount(guide, SHOWN), 0);
    assert.equal(hiddenTestHunkCount({ ...guide, steps: [CODE] }, HIDDEN), 0);
  });
});

const finding = (file: string, title: string): Finding => ({
  file,
  line: 1,
  side: "new",
  hunk: hunkIdSchema.parse("@@ -1,1 +1,1 @@"),
  priority: "p1",
  title,
  body: "…",
});

const ON_CODE = finding("src/fetch.ts", "Retries forever");
const ON_TEST = finding("src/fetch.test.ts", "Asserts nothing");
const ON_HIDDEN = finding("CHANGELOG.md", "Wrong version");
const withFindings: Guide = { ...guide, findings: [ON_CODE, ON_TEST, ON_HIDDEN] };

describe("visibleFindings", () => {
  test("shows every finding, with its index, while the findings switch is on", () => {
    assert.deepEqual(visibleFindings(withFindings, HIDDEN), [
      { index: 0, finding: ON_CODE },
      { index: 1, finding: ON_TEST },
      { index: 2, finding: ON_HIDDEN },
    ]);
  });

  test("shows none while it is off", () => {
    assert.deepEqual(visibleFindings(withFindings, { showTests: true, showFindings: false }), []);
  });

  test("a step's hunk gets only its own findings", () => {
    assert.deepEqual(findingsOn(visibleFindings(withFindings, SHOWN), entry("src/fetch.test.ts")), [{ index: 1, finding: ON_TEST }]);
  });
});

describe("stepNumberOfFinding", () => {
  test("is the shown step's number, counted from 1", () => {
    assert.equal(stepNumberOfFinding(visibleSteps(withFindings, SHOWN), ON_CODE), 2);
    assert.equal(stepNumberOfFinding(visibleSteps(withFindings, SHOWN), ON_TEST), 3);
  });

  test("is null for a finding on a test hunk while tests are hidden", () => {
    assert.equal(stepNumberOfFinding(visibleSteps(withFindings, HIDDEN), ON_TEST), null);
  });

  test("is null for a finding on a hunk the guide leaves out", () => {
    assert.equal(stepNumberOfFinding(visibleSteps(withFindings, SHOWN), ON_HIDDEN), null);
  });
});

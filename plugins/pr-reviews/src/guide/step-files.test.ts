import assert from "node:assert/strict";
import { test } from "node:test";
import { hunkIdOf, WHOLE_FILE, type DiffFile, type Hunk } from "../diff/diff-schema.ts";
import type { Guide, GuideHunk, GuideStep } from "./guide-schema.ts";
import { stepFilesOf } from "./step-files.ts";
import { visibleSteps } from "./walkthrough.ts";

const hunk = (oldStart: number, lines: string[]): Hunk => ({
  oldStart,
  oldLines: lines.filter((line) => !line.startsWith("+")).length,
  newStart: oldStart,
  newLines: lines.filter((line) => !line.startsWith("-")).length,
  lines,
});
const file = (path: string, hunks: Hunk[], binary = false, status: DiffFile["status"] = "modified"): DiffFile => ({
  path,
  previousPath: null,
  status,
  binary,
  hunks,
});
const entry = (path: string, of: Hunk | typeof WHOLE_FILE, collapsed: string | null = null): GuideHunk => ({
  file: path,
  hunk: typeof of === "string" ? of : hunkIdOf(of),
  collapsed,
});
const step = (hunks: GuideHunk[]): GuideStep => ({ title: "A step", explanation: "…", forYou: null, hunks });

const FIRST = hunk(1, [" keep", "-old", "+new", "+more"]);
const SECOND = hunk(40, ["-gone", "-gone too", " keep", "\\ No newline at end of file"]);
const OTHER = hunk(5, ["+added"]);
const UNSHOWN = hunk(90, ["+in another step", "-in another step"]);
const TEST = hunk(1, ["+it works", "-it worked"]);
const CREATED = hunk(0, ["+first line"]);
const DELETED = hunk(1, ["-last line"]);

const FILES = [
  file("src/a.ts", [FIRST, SECOND, UNSHOWN]),
  file(" src/b c.ts ", [OTHER]),
  file("docs/logo.png", [], true),
  file("src/a.test.ts", [TEST]),
  file("src/new.ts", [CREATED], false, "added"),
  file("src/old.ts", [DELETED], false, "deleted"),
];

test("one row per file, in the order the step first shows it, counting only the step's hunks of it", () => {
  const files = stepFilesOf(step([entry("src/a.ts", FIRST), entry(" src/b c.ts ", OTHER), entry("src/a.ts", SECOND, "Moved code.")]), FILES);
  assert.deepEqual(files, [
    { path: "src/a.ts", status: "modified", added: 2, removed: 3 },
    { path: " src/b c.ts ", status: "modified", added: 1, removed: 0 },
  ]);
});

test("a whole-file unit is listed with no lines", () => {
  assert.deepEqual(stepFilesOf(step([entry("docs/logo.png", WHOLE_FILE)]), FILES), [{ path: "docs/logo.png", status: "modified", added: 0, removed: 0 }]);
});

test("each file carries the PR's status for it, so the list can mark new and deleted files", () => {
  const files = stepFilesOf(step([entry("src/new.ts", CREATED), entry("src/old.ts", DELETED), entry("src/a.ts", FIRST)]), FILES);
  assert.deepEqual(
    files.map(({ path, status }) => [path, status]),
    [
      ["src/new.ts", "added"],
      ["src/old.ts", "deleted"],
      ["src/a.ts", "modified"],
    ],
  );
});

test("test hunks leave the list while the tests switch hides them, and return when it shows them", () => {
  const guide: Guide = {
    overview: { problem: "…", approach: "…", behaviour: null },
    steps: [step([entry("src/a.ts", FIRST), entry("src/a.test.ts", TEST)])],
    hidden: [],
    findings: [],
  };
  const shownWith = (showTests: boolean) => stepFilesOf(visibleSteps(guide, { showTests, showFindings: true })[0].step, FILES);
  assert.deepEqual(shownWith(false), [{ path: "src/a.ts", status: "modified", added: 2, removed: 1 }]);
  assert.deepEqual(shownWith(true), [
    { path: "src/a.ts", status: "modified", added: 2, removed: 1 },
    { path: "src/a.test.ts", status: "modified", added: 1, removed: 1 },
  ]);
});

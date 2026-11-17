import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffFieldsSchema, reportOf } from "./handoff.ts";
import { memoryFileSchema, type MemoryFile } from "./memory-file.ts";

const fields = { summary: "Retries land", did: ["Added backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [] };
const SAVED = memoryFileSchema.parse("reports/i2.md");

/** A save that records each report it is given and says it went to SAVED. */
function saves() {
  const saved: string[] = [];
  return { saved, save: (report: string): MemoryFile => (saved.push(report), SAVED) };
}

test("a build issue's done handoff delivers the commit it names, and saves no report", () => {
  const { saved, save } = saves();
  const input = handoffFieldsSchema.parse({ ...fields, status: "done", headSha: "a".repeat(40), report: "## Unasked" });
  assert.deepEqual(reportOf(input, "build", save), { ...fields, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } });
  assert.deepEqual(saved, []);
});

test("a build issue's done handoff without a commit is refused; a blocked one needs none and drops any it gives", () => {
  const { save } = saves();
  assert.deepEqual(reportOf(handoffFieldsSchema.parse({ ...fields, status: "done" }), "build", save), { refused: "A done handoff needs headSha: the output of `git rev-parse HEAD` after your last commit." });
  assert.deepEqual(reportOf(handoffFieldsSchema.parse({ ...fields, status: "blocked", headSha: "a".repeat(40) }), "build", save), { ...fields, status: "blocked" });
});

test("a research issue's done handoff delivers its report where it was saved, and drops a commit and a pull request given anyway", () => {
  const { saved, save } = saves();
  const input = handoffFieldsSchema.parse({ ...fields, status: "done", report: "  ## Pick Vault\n\nIt fits.  ", headSha: "a".repeat(40), prUrl: "https://github.com/acme/webhooks/pull/7" });
  assert.deepEqual(reportOf(input, "research", save), { ...fields, status: "done", delivery: { kind: "report", report: "## Pick Vault\n\nIt fits.", file: SAVED } });
  assert.deepEqual(saved, ["## Pick Vault\n\nIt fits."]);
});

test("a research issue's done handoff without a report is refused and saves nothing; a blocked one needs none", () => {
  const { saved, save } = saves();
  assert.deepEqual(reportOf(handoffFieldsSchema.parse({ ...fields, status: "done", headSha: "a".repeat(40) }), "research", save), {
    refused: "A done handoff of a research issue needs report: your report, in markdown. It names no commit.",
  });
  assert.deepEqual(reportOf(handoffFieldsSchema.parse({ ...fields, status: "blocked", report: "Half of it" }), "research", save), { ...fields, status: "blocked" });
  assert.deepEqual(saved, []);
});

test("a report over 20,000 characters is rejected", () => {
  assert.equal(handoffFieldsSchema.safeParse({ ...fields, status: "done", report: "x".repeat(20_001) }).success, false);
  assert.equal(handoffFieldsSchema.safeParse({ ...fields, status: "done", report: "x".repeat(20_000) }).success, true);
});

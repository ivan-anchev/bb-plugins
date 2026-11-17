import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffFieldsSchema, reportOf } from "./handoff.ts";

const fields = { summary: "Retries land", did: ["Added backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [] };

test("a build issue's done handoff delivers the commit it names", () => {
  const input = handoffFieldsSchema.parse({ ...fields, status: "done", headSha: "a".repeat(40) });
  assert.deepEqual(reportOf(input, "build"), { ...fields, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } });
});

test("a build issue's done handoff without a commit is refused; a blocked one needs none and drops any it gives", () => {
  assert.deepEqual(reportOf(handoffFieldsSchema.parse({ ...fields, status: "done" }), "build"), { refused: "A done handoff needs headSha: the output of `git rev-parse HEAD` after your last commit." });
  assert.deepEqual(reportOf(handoffFieldsSchema.parse({ ...fields, status: "blocked", headSha: "a".repeat(40) }), "build"), { ...fields, status: "blocked" });
});

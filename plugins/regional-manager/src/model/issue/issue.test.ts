import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema, briefToStart } from "./issue.ts";

const planned = { id: issueIdSchema.parse("WEB-1"), kind: "build", brief: "Retry failed deliveries.", doneCriteria: ["npm test passes"] } as const;

test("an agent starts on a build issue only once it has a brief and a done-criterion", () => {
  assert.deepEqual(briefToStart({ ...planned, doneCriteria: [...planned.doneCriteria] }), { brief: "Retry failed deliveries." });
  assert.deepEqual(briefToStart({ ...planned, brief: null, doneCriteria: [] }), { refused: "WEB-1 has no brief yet. Write one with issue_update." });
  assert.deepEqual(briefToStart({ ...planned, doneCriteria: [] }), { refused: "WEB-1 needs done-criteria (at least 1) before an agent starts. Add doneCriteria with issue_update." });
});

test("an issue id is the project's key and a number from 1; the i4 of earlier releases is none", () => {
  for (const id of ["BBP-4", "UI-1", "X-12", "ISS-100"]) assert.equal(issueIdSchema.safeParse(id).success, true, id);
  for (const id of ["i4", "BBP-0", "BBP-04", "bbp-4", "ABCD-4", "BBP4", "BBP-", "-4"]) assert.equal(issueIdSchema.safeParse(id).success, false, id);
});

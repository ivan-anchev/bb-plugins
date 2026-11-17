import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema, startRefusal } from "./issue.ts";

const planned = { id: issueIdSchema.parse("i1"), kind: "build", brief: "Retry failed deliveries.", doneCriteria: ["npm test passes"] } as const;

test("an agent starts on a build issue only once it has a brief and a done-criterion", () => {
  assert.equal(startRefusal({ ...planned, doneCriteria: [...planned.doneCriteria] }), null);
  assert.equal(startRefusal({ ...planned, brief: null, doneCriteria: [] }), "i1 has no brief yet. Write one with issue_update.");
  assert.equal(startRefusal({ ...planned, doneCriteria: [] }), "i1 needs done-criteria (at least 1) before an agent starts. Add doneCriteria with issue_update.");
});

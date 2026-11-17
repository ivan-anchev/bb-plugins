import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema, briefToStart } from "./issue.ts";

const planned = { id: issueIdSchema.parse("i1"), kind: "build", brief: "Retry failed deliveries.", doneCriteria: ["npm test passes"] } as const;

test("an agent starts on a build issue only once it has a brief and a done-criterion", () => {
  assert.deepEqual(briefToStart({ ...planned, doneCriteria: [...planned.doneCriteria] }), { brief: "Retry failed deliveries." });
  assert.deepEqual(briefToStart({ ...planned, brief: null, doneCriteria: [] }), { refused: "i1 has no brief yet. Write one with issue_update." });
  assert.deepEqual(briefToStart({ ...planned, doneCriteria: [] }), { refused: "i1 needs done-criteria (at least 1) before an agent starts. Add doneCriteria with issue_update." });
});

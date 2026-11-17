// What the board's reads send of dependencies: each row's open blockers, and an opened issue's
// dependencies and dependents, as the tools file and close them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinating, ISSUE } from "../test-harness.ts";

const id = (raw: string) => issueIdSchema.parse(raw);

test("a row sends the open issues it depends on, and an opened issue what it depends on and what depends on it, nothing else", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const file = (input: object) => kit.call("issue_create", { ...ISSUE, ...input }, threadId);
  await file({ title: "Retry budget" });
  await file({ title: "Retry queue", dependsOn: ["i1"] });
  await file({ title: "Dead letters", dependsOn: ["i1", "i2"] });
  const blockers = async () => Object.fromEntries((await kit.rpc.board({ coordinatorId })).issues.map(({ id, blockedBy }) => [id, blockedBy]));
  const opened = (issueId: string) => kit.rpc.issue({ coordinatorId, issueId: id(issueId) });

  assert.deepEqual(await blockers(), { i1: [], i2: ["i1"], i3: ["i1", "i2"] });
  const first = await opened("i1");
  assert.deepEqual([first.dependsOn, first.blocks], [[], ["i2", "i3"]]);
  const last = await opened("i3");
  assert.deepEqual([last.dependsOn, last.blocks], [["i1", "i2"], []]);
  assert.deepEqual(Object.keys(last).sort(), ["blocks", "dependsOn", "description", "doneCriteria", "record"], "an opened issue sends only what its detail shows");

  await kit.call("issue_update", { id: "i1", status: "canceled" }, threadId);
  assert.deepEqual(await blockers(), { i1: [], i2: [], i3: ["i2"] }, "a closed dependency blocks no more");
  assert.deepEqual((await opened("i3")).dependsOn, ["i1", "i2"], "it still depends on the closed one");
});

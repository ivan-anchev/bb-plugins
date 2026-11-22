import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinating, ISSUE } from "../test-harness.ts";

const id = (raw: string) => issueIdSchema.parse(raw);

test("a row sends the open issues it depends on, and an opened issue what it depends on and what depends on it, nothing else", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const file = (input: object) => kit.call("issue_create", { ...ISSUE, ...input }, threadId);
  await file({ title: "Retry budget" });
  await file({ title: "Retry queue", dependsOn: ["WEB-1"] });
  await file({ title: "Dead letters", dependsOn: ["WEB-1", "WEB-2"] });
  const blockers = async () => Object.fromEntries((await kit.rpc.board({ coordinatorId })).issues.map(({ id, blockedBy }) => [id, blockedBy]));
  const opened = (issueId: string) => kit.rpc.issue({ coordinatorId, issueId: id(issueId) });

  assert.deepEqual(await blockers(), { "WEB-1": [], "WEB-2": ["WEB-1"], "WEB-3": ["WEB-1", "WEB-2"] });
  const first = await opened("WEB-1");
  assert.deepEqual([first.dependsOn, first.blocks], [[], ["WEB-2", "WEB-3"]]);
  const last = await opened("WEB-3");
  assert.deepEqual([last.dependsOn, last.blocks], [["WEB-1", "WEB-2"], []]);
  assert.deepEqual(Object.keys(last).sort(), ["blocks", "decisions", "dependsOn", "description", "doneCriteria", "finalChecks", "record"], "an opened issue sends only what its detail shows");

  await kit.call("issue_update", { id: "WEB-1", status: "canceled" }, threadId);
  assert.deepEqual(await blockers(), { "WEB-1": [], "WEB-2": [], "WEB-3": ["WEB-2"] }, "a closed dependency blocks no more");
  assert.deepEqual((await opened("WEB-3")).dependsOn, ["WEB-1", "WEB-2"], "it still depends on the closed one");
});

test("a sub-issue's row sends its parent's open dependencies as its blockers; its own detail lists only its own", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const file = (input: object) => kit.call("issue_create", { ...ISSUE, ...input }, threadId);
  await file({ title: "Retry budget" });
  await file({ title: "Retry queue", dependsOn: ["WEB-1"] });
  await file({ title: "Queue schema", parent: "WEB-2" });

  const rows = (await kit.rpc.board({ coordinatorId })).issues;
  assert.deepEqual(rows.map(({ id, parentId, blockedBy }) => [id, parentId, blockedBy]), [["WEB-1", null, []], ["WEB-2", null, ["WEB-1"]], ["WEB-3", "WEB-2", ["WEB-1"]]]);
  const sub = await kit.rpc.issue({ coordinatorId, issueId: id("WEB-3") });
  assert.deepEqual([sub.dependsOn, sub.blocks], [[], []]);
  assert.deepEqual((await kit.rpc.issue({ coordinatorId, issueId: id("WEB-1") })).blocks, ["WEB-2"], "what it blocks through a parent is that parent");
});

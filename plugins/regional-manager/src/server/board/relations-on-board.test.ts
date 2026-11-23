// What the board's reads send of dependencies: each row's open blockers, its parent's among them,
// and the open issues it blocks; and an opened issue's own dependencies and dependents, as the tools
// file and close them.
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
  const opened = (issueId: string) => kit.rpc.issueFeed({ coordinatorId, issueId: id(issueId) });

  assert.deepEqual(await blockers(), { "WEB-1": [], "WEB-2": ["WEB-1"], "WEB-3": ["WEB-1", "WEB-2"] });
  const first = await opened("WEB-1");
  assert.deepEqual([first.dependsOn, first.blocks], [[], ["WEB-2", "WEB-3"]]);
  const last = await opened("WEB-3");
  assert.deepEqual([last.dependsOn, last.blocks], [["WEB-1", "WEB-2"], []]);
  assert.deepEqual(Object.keys(last).sort(), ["agents", "blocks", "dependsOn", "description", "doneCriteria", "entries"], "an opened issue sends only what its tab reads");

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
  const sub = await kit.rpc.issueFeed({ coordinatorId, issueId: id("WEB-3") });
  assert.deepEqual([sub.dependsOn, sub.blocks], [[], []]);
  assert.deepEqual((await kit.rpc.issueFeed({ coordinatorId, issueId: id("WEB-1") })).blocks, ["WEB-2"], "what it blocks through a parent is that parent");
});

test("a row sends the open issues that depend on it while it is open itself: a closed dependent isn't blocked, and a closed issue blocks nothing", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const file = (input: object) => kit.call("issue_create", { ...ISSUE, ...input }, threadId);
  await file({ title: "Retry budget" });
  await file({ title: "Retry queue", dependsOn: ["WEB-1"] });
  await file({ title: "Dead letters", dependsOn: ["WEB-1", "WEB-2"] });
  await file({ title: "Queue schema", parent: "WEB-2" });
  const blocking = async () => Object.fromEntries((await kit.rpc.board({ coordinatorId })).issues.map(({ id, blocks }) => [id, blocks]));

  assert.deepEqual(await blocking(), { "WEB-1": ["WEB-2", "WEB-3"], "WEB-2": ["WEB-3"], "WEB-3": [], "WEB-4": [] }, "what depends on it itself; a parent's dependent is the parent");

  await kit.call("issue_update", { id: "WEB-3", status: "canceled" }, threadId);
  assert.deepEqual(await blocking(), { "WEB-1": ["WEB-2"], "WEB-2": [], "WEB-3": [], "WEB-4": [] }, "a canceled dependent waits on nothing");

  await kit.call("issue_update", { id: "WEB-1", status: "canceled" }, threadId);
  assert.deepEqual(await blocking(), { "WEB-1": [], "WEB-2": [], "WEB-3": [], "WEB-4": [] }, "a canceled issue blocks nothing, though WEB-2 still depends on it");
  assert.deepEqual((await kit.rpc.issueFeed({ coordinatorId, issueId: id("WEB-2") })).dependsOn, ["WEB-1"], "the dependency itself is kept");
});

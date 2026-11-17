import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import { EXECUTION, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../test-store.ts";

test("issues are numbered i1, i2… within their regional manager, and read back as filed", () => {
  const { store } = freshStore();
  const first = store.insertIssue(MANAGER, newIssue(), 2_000);
  const second = store.insertIssue(MANAGER, newIssue({ title: "Log retries", brief: null, doneCriteria: [], verifier: EXECUTION, rest: "backlog" }), 2_100);
  const elsewhere = store.insertIssue(OTHER_MANAGER, newIssue(), 2_200);

  assert.deepEqual([first.id, second.id, elsewhere.id], ["i1", "i2", "i1"]);
  assert.deepEqual(store.issues(MANAGER), [first, second]);
  assert.deepEqual(store.issue(MANAGER, second.id), { ...newIssue({ title: "Log retries", brief: null, doneCriteria: [], verifier: EXECUTION, rest: "backlog" }), id: "i2", coordinatorId: MANAGER, closed: null, createdAt: 2_100 });
  assert.equal(store.issue(MANAGER, issueIdSchema.parse("i3")), null);
});

test("an issue id is never reused: one filed after a gap is numbered after the highest", () => {
  const { db, store } = freshStore();
  for (const at of [2_000, 2_100, 2_200]) store.insertIssue(MANAGER, newIssue(), at);
  // why a raw delete: the store never deletes an issue, but whatever does must not free its id.
  db.prepare("DELETE FROM issues WHERE id = 'i1'").run();
  assert.equal(store.insertIssue(MANAGER, newIssue(), 2_300).id, "i4");
});

test("an edit changes only the fields it names; an issue the manager doesn't have is refused", () => {
  const { store } = freshStore();
  const filed = store.insertIssue(MANAGER, newIssue(), 2_000);
  const edited = store.updateIssue(MANAGER, filed.id, { brief: "Retry with jitter.", verifier: EXECUTION }, { requireUnheld: false });
  assert.deepEqual(edited, { issue: { ...filed, brief: "Retry with jitter.", verifier: EXECUTION } });
  assert.deepEqual(store.issue(MANAGER, filed.id), { ...filed, brief: "Retry with jitter.", verifier: EXECUTION });

  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { verifier: null, closed: { as: "canceled", at: 3_000 } }, { requireUnheld: false }), { issue: { ...filed, brief: "Retry with jitter.", closed: { as: "canceled", at: 3_000 } } });
  assert.deepEqual(store.updateIssue(MANAGER, issueIdSchema.parse("i9"), { title: "Nope" }, { requireUnheld: false }), { refused: "You have no issue i9." });
});

test("an edit that needs the issue unheld is refused while an agent holds it, and applies once the agent ended", () => {
  const { store } = freshStore();
  const filed = store.insertIssue(MANAGER, newIssue(), 2_000);
  const agentId = startAgent(store, filed.id, "agent-1");

  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { rest: "backlog" }, { requireUnheld: true }), { refused: "An agent holds i1. Stop it with agent_stop first." });
  assert.equal(store.issue(MANAGER, filed.id)?.rest, "todo");
  store.updateIssue(MANAGER, filed.id, { title: "Retries, with jitter" }, { requireUnheld: false });
  assert.equal(store.issue(MANAGER, filed.id)?.title, "Retries, with jitter", "an edit that may happen while held does");

  store.endAgent({ coordinatorId: MANAGER, id: agentId, issueId: filed.id }, "stopped", null, false, 3_000);
  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { rest: "backlog" }, { requireUnheld: true }), { issue: { ...filed, title: "Retries, with jitter", rest: "backlog" } });
});

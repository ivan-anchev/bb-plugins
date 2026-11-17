import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import { knownCloses, rememberCloses } from "./issues-store.ts";
import { EXECUTION, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../test-store.ts";

test("issues are numbered i1, i2… within their regional manager, and read back as filed", () => {
  const { store } = freshStore();
  const first = filedIssue(store, MANAGER, newIssue(), 2_000);
  const second = filedIssue(store, MANAGER, newIssue({ title: "Log retries", brief: null, doneCriteria: [], verifier: EXECUTION, rest: "backlog" }), 2_100);
  const elsewhere = filedIssue(store, OTHER_MANAGER, newIssue(), 2_200);

  assert.deepEqual([first.id, second.id, elsewhere.id], ["i1", "i2", "i1"]);
  assert.deepEqual(store.issues(MANAGER), [first, second]);
  assert.deepEqual(store.issue(MANAGER, second.id), { ...newIssue({ title: "Log retries", brief: null, doneCriteria: [], verifier: EXECUTION, rest: "backlog" }), id: "i2", coordinatorId: MANAGER, closed: null, createdAt: 2_100 });
  assert.equal(store.issue(MANAGER, issueIdSchema.parse("i3")), null);
});

test("an issue id is never reused: one filed after a gap is numbered after the highest", () => {
  const { db, store } = freshStore();
  for (const at of [2_000, 2_100, 2_200]) filedIssue(store, MANAGER, newIssue(), at);
  // why a raw delete: the store never deletes an issue, but whatever does must not free its id.
  db.prepare("DELETE FROM issues WHERE id = 'i1'").run();
  assert.equal(filedIssue(store, MANAGER, newIssue(), 2_300).id, "i4");
});

test("an edit changes only the fields it names; an issue the manager doesn't have is refused", () => {
  const { store } = freshStore();
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  const edited = store.updateIssue(MANAGER, filed.id, { brief: "Retry with jitter.", verifier: EXECUTION }, { requireUnheld: false, closes: new Map() });
  assert.deepEqual(edited, { issue: { ...filed, brief: "Retry with jitter.", verifier: EXECUTION } });
  assert.deepEqual(store.issue(MANAGER, filed.id), { ...filed, brief: "Retry with jitter.", verifier: EXECUTION });

  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { verifier: null, closed: { as: "canceled", at: 3_000 } }, { requireUnheld: false, closes: new Map() }), { issue: { ...filed, brief: "Retry with jitter.", closed: { as: "canceled", at: 3_000 } } });
  assert.deepEqual(store.updateIssue(MANAGER, issueIdSchema.parse("i9"), { title: "Nope" }, { requireUnheld: false, closes: new Map() }), { refused: "You have no issue i9." });
});

test("an edit that needs the issue unheld is refused while an agent holds it, and applies once the agent ended", () => {
  const { store } = freshStore();
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agentId = startAgent(store, filed.id, "agent-1");

  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { rest: "backlog" }, { requireUnheld: true, closes: new Map() }), { refused: "An agent holds i1. Stop it with agent_stop first." });
  assert.equal(store.issue(MANAGER, filed.id)?.rest, "todo");
  store.updateIssue(MANAGER, filed.id, { title: "Retries, with jitter" }, { requireUnheld: false, closes: new Map() });
  assert.equal(store.issue(MANAGER, filed.id)?.title, "Retries, with jitter", "an edit that may happen while held does");

  store.endAgent({ coordinatorId: MANAGER, id: agentId, issueId: filed.id }, "stopped", null, false, 3_000);
  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { rest: "backlog" }, { requireUnheld: true, closes: new Map() }), { issue: { ...filed, title: "Retries, with jitter", rest: "backlog" } });
});

test("an issue's dependencies are stored in the order added, changed by what is added and removed, and read back with it", () => {
  const { db, store } = freshStore();
  const [i1, i2, i3] = [1, 2, 3].map(() => filedIssue(store, MANAGER, newIssue(), 2_000).id);
  const filed = filedIssue(store, MANAGER, newIssue({ dependsOn: [i3, i1, i3] }), 2_100);
  assert.deepEqual(store.issue(MANAGER, filed.id)?.dependsOn, [i3, i1]);

  const edited = store.updateIssue(MANAGER, filed.id, { dependsOn: { add: [i2, i1], remove: [i3] } }, { requireUnheld: false, closes: new Map() });
  assert.deepEqual("issue" in edited && edited.issue.dependsOn, [i1, i2]);
  assert.deepEqual(store.issue(MANAGER, filed.id)?.dependsOn, [i1, i2]);
  assert.deepEqual(store.issue(MANAGER, i1)?.dependsOn, []);

  // why the close known: a kept relation that moves keeps what the manager was told of it.
  rememberCloses(() => db, MANAGER, new Map([[filed.id, new Map([[i1, "merged #41"]])]]));
  const moved = store.updateIssue(MANAGER, filed.id, { dependsOn: { add: [i1], remove: [i1] } }, { requireUnheld: false, closes: new Map() });
  assert.deepEqual("issue" in moved && moved.issue.dependsOn, [i2, i1]);
  assert.deepEqual(store.issue(MANAGER, filed.id)?.dependsOn, [i2, i1]);
  assert.deepEqual(knownCloses(() => db, MANAGER).get(filed.id), new Map([[i2, null], [i1, "merged #41"]]));
});

test("a dependency on no issue files nothing, and one that closes a cycle changes nothing of its edit", () => {
  const { store } = freshStore();
  const i1 = filedIssue(store, MANAGER, newIssue(), 2_000);
  const i2 = filedIssue(store, MANAGER, newIssue({ dependsOn: [i1.id] }), 2_100);
  const before = store.issues(MANAGER);

  assert.deepEqual(store.insertIssue(MANAGER, newIssue({ dependsOn: [issueIdSchema.parse("i7")] }), new Map(), 2_300), { refused: "i3 can't depend on i7: there is no issue i7." });
  assert.deepEqual(store.updateIssue(MANAGER, i1.id, { title: "Retry budget", dependsOn: { add: [i2.id], remove: [] } }, { requireUnheld: false, closes: new Map() }), {
    refused: "i1 can't depend on i2: that would close a cycle, i1 → i2 → i1.",
  });
  assert.deepEqual(store.issues(MANAGER), before);
});

test("a dependency that fails to be written takes the issue's filing, or the rest of its edit (its parent too), back with it", () => {
  const { db, store } = freshStore();
  const i1 = filedIssue(store, MANAGER, newIssue(), 2_000);
  const i2 = filedIssue(store, MANAGER, newIssue({ dependsOn: [i1.id] }), 2_100);
  const i3 = filedIssue(store, MANAGER, newIssue(), 2_150);
  const allow = failWrites(db, "INSERT", "issue_relations");
  assert.throws(() => store.insertIssue(MANAGER, newIssue({ parentId: i3.id, dependsOn: [i1.id] }), new Map(), 2_200), /forced failure/);
  assert.throws(() => store.updateIssue(MANAGER, i2.id, { title: "Dead letters", parentId: i1.id, dependsOn: { add: [i3.id], remove: [i1.id] } }, { requireUnheld: false, closes: new Map() }), /forced failure/);
  assert.deepEqual(store.issues(MANAGER), [i1, i2, i3]);

  allow();
  assert.equal(filedIssue(store, MANAGER, newIssue({ dependsOn: [i1.id] }), 2_200).id, "i4");
});

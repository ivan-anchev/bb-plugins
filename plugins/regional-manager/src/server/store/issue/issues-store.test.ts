import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import { knownCloses, rememberCloses, type IssueEdit } from "./issues-store.ts";
import { EXECUTION, failOnMustFix, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../test-store.ts";

test("issues are numbered WEB-1, WEB-2… within their regional manager, and read back as filed", () => {
  const { store } = freshStore();
  const first = filedIssue(store, MANAGER, newIssue(), 2_000);
  const second = filedIssue(store, MANAGER, newIssue({ title: "Log retries", brief: null, doneCriteria: [], verifier: EXECUTION, rest: "backlog" }), 2_100);
  const elsewhere = filedIssue(store, OTHER_MANAGER, newIssue(), 2_200);

  assert.deepEqual([first.id, second.id, elsewhere.id], ["WEB-1", "WEB-2", "WEB-1"]);
  assert.deepEqual(store.issues(MANAGER), [first, second]);
  assert.deepEqual(store.issue(MANAGER, second.id), { ...newIssue({ title: "Log retries", brief: null, doneCriteria: [], verifier: EXECUTION, rest: "backlog" }), id: "WEB-2", coordinatorId: MANAGER, closed: null, createdAt: 2_100 });
  assert.equal(store.issue(MANAGER, issueIdSchema.parse("WEB-3")), null);
});

test("an issue id is never reused: one filed after a gap is numbered after the highest", () => {
  const { db, store } = freshStore();
  for (const at of [2_000, 2_100, 2_200]) filedIssue(store, MANAGER, newIssue(), at);
  // why a raw delete: the store never deletes an issue, but whatever does must not free its id.
  db.prepare("DELETE FROM issues WHERE id = 'WEB-1'").run();
  assert.equal(filedIssue(store, MANAGER, newIssue(), 2_300).id, "WEB-4");
});

test("an edit changes only the fields it names; an issue the manager doesn't have is refused", () => {
  const { store } = freshStore();
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  const edited = store.updateIssue(MANAGER, filed.id, { brief: "Retry with jitter.", verifier: EXECUTION }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  assert.deepEqual(edited, { issue: { ...filed, brief: "Retry with jitter.", verifier: EXECUTION } });
  assert.deepEqual(store.issue(MANAGER, filed.id), { ...filed, brief: "Retry with jitter.", verifier: EXECUTION });

  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { verifier: null, closed: { as: "canceled", at: 3_000 } }, { requireUnheld: false, closes: new Map(), at: 3_000 }), { issue: { ...filed, brief: "Retry with jitter.", closed: { as: "canceled", at: 3_000 } } });
  assert.deepEqual(store.updateIssue(MANAGER, issueIdSchema.parse("WEB-9"), { title: "Nope" }, { requireUnheld: false, closes: new Map(), at: 3_000 }), { refused: "You have no issue WEB-9." });
});

test("an edit that needs the issue unheld is refused while an agent holds it, and applies once the agent ended", () => {
  const { store } = freshStore();
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  const agentId = startAgent(store, filed.id, "agent-1");

  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { rest: "backlog" }, { requireUnheld: true, closes: new Map(), at: 3_000 }), { refused: "An agent holds WEB-1. Stop it with agent_stop first." });
  assert.equal(store.issue(MANAGER, filed.id)?.rest, "todo");
  store.updateIssue(MANAGER, filed.id, { title: "Retries, with jitter" }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  assert.equal(store.issue(MANAGER, filed.id)?.title, "Retries, with jitter", "an edit that may happen while held does");

  store.endAgent({ coordinatorId: MANAGER, id: agentId, issueId: filed.id }, "stopped", null, false, 3_000);
  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { rest: "backlog" }, { requireUnheld: true, closes: new Map(), at: 3_000 }), { issue: { ...filed, title: "Retries, with jitter", rest: "backlog" } });
});

test("an issue's dependencies are stored in the order added, changed by what is added and removed, and read back with it", () => {
  const { db, store } = freshStore();
  const [i1, i2, i3] = [1, 2, 3].map(() => filedIssue(store, MANAGER, newIssue(), 2_000).id);
  const filed = filedIssue(store, MANAGER, newIssue({ dependsOn: [i3, i1, i3] }), 2_100);
  assert.deepEqual(store.issue(MANAGER, filed.id)?.dependsOn, [i3, i1]);

  const edited = store.updateIssue(MANAGER, filed.id, { dependsOn: { add: [i2, i1], remove: [i3] } }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  assert.deepEqual("issue" in edited && edited.issue.dependsOn, [i1, i2]);
  assert.deepEqual(store.issue(MANAGER, filed.id)?.dependsOn, [i1, i2]);
  assert.deepEqual(store.issue(MANAGER, i1)?.dependsOn, []);

  // why the close known: a kept relation that moves keeps what the manager was told of it.
  rememberCloses(() => db, MANAGER, new Map([[filed.id, new Map([[i1, "merged #41"]])]]));
  const moved = store.updateIssue(MANAGER, filed.id, { dependsOn: { add: [i1], remove: [i1] } }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  assert.deepEqual("issue" in moved && moved.issue.dependsOn, [i2, i1]);
  assert.deepEqual(store.issue(MANAGER, filed.id)?.dependsOn, [i2, i1]);
  assert.deepEqual(knownCloses(() => db, MANAGER).get(filed.id), new Map([[i2, null], [i1, "merged #41"]]));
});

test("a dependency on no issue files nothing, and one that closes a cycle changes nothing of its edit", () => {
  const { store } = freshStore();
  const i1 = filedIssue(store, MANAGER, newIssue(), 2_000);
  const i2 = filedIssue(store, MANAGER, newIssue({ dependsOn: [i1.id] }), 2_100);
  const before = store.issues(MANAGER);

  assert.deepEqual(store.insertIssue(MANAGER, newIssue({ dependsOn: [issueIdSchema.parse("WEB-7")] }), new Map(), 2_300), { refused: "WEB-3 can't depend on WEB-7: there is no issue WEB-7." });
  assert.deepEqual(store.updateIssue(MANAGER, i1.id, { title: "Retry budget", dependsOn: { add: [i2.id], remove: [] } }, { requireUnheld: false, closes: new Map(), at: 3_000 }), {
    refused: "WEB-1 can't depend on WEB-2: that would close a cycle, WEB-1 → WEB-2 → WEB-1.",
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
  assert.throws(() => store.updateIssue(MANAGER, i2.id, { title: "Dead letters", parentId: i1.id, dependsOn: { add: [i3.id], remove: [i1.id] } }, { requireUnheld: false, closes: new Map(), at: 3_000 }), /forced failure/);
  assert.deepEqual(store.issues(MANAGER), [i1, i2, i3]);

  allow();
  assert.equal(filedIssue(store, MANAGER, newIssue({ dependsOn: [i1.id] }), 2_200).id, "WEB-4");
});

test("an edit logs what it changed of the plan, in a fixed order, at the time given; one that changes nothing logs nothing", () => {
  const { store } = freshStore();
  const dependency = filedIssue(store, MANAGER, newIssue(), 2_000).id;
  const parent = filedIssue(store, MANAGER, newIssue({ kind: "build" }), 2_000).id;
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  const edit = (change: IssueEdit, at: number) => {
    const applied = store.updateIssue(MANAGER, filed.id, change, { requireUnheld: false, closes: new Map(), at });
    assert.ok("issue" in applied, JSON.stringify(applied));
    return store.logOf(MANAGER, filed.id).filter((row) => row.at === at).map(({ event }) => event);
  };

  assert.deepEqual(store.logOf(MANAGER, filed.id), [], "filing logs nothing: the issue's own time says when");
  assert.deepEqual(edit({ title: "Retries, capped", dependsOn: { add: [dependency], remove: [] } }, 3_000), [
    { kind: "edited", fields: ["title"] },
    { kind: "dependency-added", on: dependency },
  ]);
  assert.deepEqual(edit({ closed: { as: "canceled", at: 3_100 } }, 3_100), [{ kind: "closed", as: "canceled" }]);
  assert.deepEqual(edit({ closed: null }, 3_200), [{ kind: "reopened" }]);
  assert.deepEqual(edit({ parentId: parent }, 3_300), [{ kind: "parent-set", parentId: parent }]);
  assert.deepEqual(edit({ rest: "backlog" }, 3_400), [{ kind: "rested", rest: "backlog" }]);
  assert.deepEqual(edit({ parentId: null, dependsOn: { add: [], remove: [dependency] }, doneCriteria: ["npm test passes", "lint is clean"], brief: "Cap the backoff." }, 3_500), [
    { kind: "edited", fields: ["brief", "criteria"] },
    { kind: "parent-set", parentId: null },
    { kind: "dependency-removed", on: dependency },
  ]);
  assert.deepEqual(edit({ title: "Retries, capped", rest: "backlog", dependsOn: { add: [], remove: [] } }, 3_600), [], "the same values again");
  assert.deepEqual(edit({ verifier: EXECUTION, reviewer: EXECUTION }, 3_700), [{ kind: "edited", fields: ["verifier", "reviewer"] }]);
  assert.deepEqual(edit({ reviewer: null }, 3_800), [{ kind: "edited", fields: ["reviewer"] }]);
  assert.equal(store.logOf(MANAGER, filed.id).length, 11);
});

test("an edit whose log fails to be written takes the edit back with it, its reviewer included, and the same edit then applies and is logged", () => {
  const { db, store } = freshStore();
  const dependency = filedIssue(store, MANAGER, newIssue(), 2_000).id;
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  const edit: IssueEdit = { title: "Retries, capped", reviewer: EXECUTION, dependsOn: { add: [dependency], remove: [] } };
  const restore = failWrites(db, "INSERT", "issue_log");
  assert.throws(() => store.updateIssue(MANAGER, filed.id, edit, { requireUnheld: false, closes: new Map(), at: 3_000 }), /forced failure/);
  assert.deepEqual(store.issue(MANAGER, filed.id), filed, "its title, reviewer and dependencies as they were");
  assert.deepEqual(store.logOf(MANAGER, filed.id), []);

  restore();
  assert.deepEqual(store.updateIssue(MANAGER, filed.id, edit, { requireUnheld: false, closes: new Map(), at: 3_100 }), { issue: { ...filed, title: "Retries, capped", reviewer: EXECUTION, dependsOn: [dependency] } });
  assert.deepEqual(store.issue(MANAGER, filed.id)?.reviewer, EXECUTION, "the reviewer stored");
  assert.deepEqual(store.logOf(MANAGER, filed.id), [
    { at: 3_100, event: { kind: "edited", fields: ["title", "reviewer"] } },
    { at: 3_100, event: { kind: "dependency-added", on: dependency } },
  ]);
});

test("an accept whose follow-up fails to be filed takes its stamp, its decision and its log back with it, and the same accept then files one follow-up", () => {
  const { db, store } = freshStore();
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  const failed = failOnMustFix(store, filed.id, startAgent(store, filed.id, "agent-1"), 1, 2_500);
  const accept: IssueEdit = { decision: { text: "Criteria all pass; the cap is polish.", at: 3_000 }, accept: failed.id };
  const restore = failWrites(db, "INSERT", "issues");
  assert.throws(() => store.updateIssue(MANAGER, filed.id, accept, { requireUnheld: false, closes: new Map(), at: 3_000 }), /forced failure/);
  assert.equal(store.check(failed.id)?.acceptedAt, null, "its stamp undone");
  assert.deepEqual(store.recordedDecisions(MANAGER, filed.id), [], "its decision undone");
  assert.deepEqual(store.logOf(MANAGER, filed.id), [], "its log undone");
  assert.deepEqual(store.issues(MANAGER).map(({ id }) => id), [filed.id]);

  restore();
  assert.deepEqual(store.updateIssue(MANAGER, filed.id, { ...accept, decision: { text: "Criteria all pass; the cap is polish.", at: 3_100 } }, { requireUnheld: false, closes: new Map(), at: 3_100 }), { issue: filed });
  const followUp = issueIdSchema.parse("WEB-2");
  const stamped = store.check(failed.id);
  assert.deepEqual([stamped?.acceptedAt, stamped?.followUpId], [3_100, followUp]);
  assert.deepEqual(store.recordedDecisions(MANAGER, filed.id), [{ kind: "recorded", text: "Criteria all pass; the cap is polish.", at: 3_100 }]);
  assert.deepEqual(store.logOf(MANAGER, filed.id), [{ at: 3_100, event: { kind: "accepted" } }]);
  assert.deepEqual(store.issues(MANAGER).map(({ id, dependsOn }) => [id, dependsOn]), [[filed.id, []], [followUp, [filed.id]]], "one follow-up, depending on its origin");
  assert.match(store.issue(MANAGER, followUp)?.brief ?? "", /`src\/retry\.ts:10` \(must-fix\): The backoff never caps\./);
});

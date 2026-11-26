import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type Database from "better-sqlite3";
import { handoffIdSchema } from "../../../../model/agent/handoff.ts";
import { issueKeySchema } from "../../../../model/issue/key/issue-key.ts";
import { issueIdSchema } from "../../../../model/issue/issue.ts";
import type { CheckoutRead } from "../../../../model/verdict/checkout.ts";
import { asBeforeKeys, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../../test-store.ts";

const BBP = issueKeySchema.parse("BBP");
const id = issueIdSchema.parse;
const SHA = "a".repeat(40);
const CLEAN: CheckoutRead = { kind: "read", branch: null, checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 } };

/**
 * A store whose regional manager MANAGER holds what 0.5.0 stored, its issues numbered i1, i2, i3 and
 * no issue key: a parent i1 with a sub-issue i2, which i3 depends on; an agent on i2 whose done
 * handoff ("Retries land on i1") is checked by a verifier, a final check of i1 judging i2's merged
 * work, a question to the user and a recorded decision on i3, i3's log of a dependency on i1 added
 * and removed and of its status, the event announcing i3 unblocked by i2, and the user's comment on i3
 * with the manager's reply. OTHER_MANAGER keeps its key, WEB, and its issue WEB-1.
 */
function storedBy050() {
  const { db, store } = freshStore();
  const parent = filedIssue(store, MANAGER, newIssue(), 2_000);
  const sub = filedIssue(store, MANAGER, newIssue({ parentId: parent.id }), 2_000);
  const dependent = filedIssue(store, MANAGER, newIssue({ dependsOn: [sub.id] }), 2_000);
  const agentId = startAgent(store, sub.id, "agent-1");
  const handoff = { id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId: sub.id, agentId, at: 3_000, turnSeq: 1, summary: `Retries land on ${parent.id}`, did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const check = store.insertHandoff({ ...handoff, status: "done", delivery: { kind: "commit", headSha: SHA, prUrl: null } }, CLEAN) ?? assert.fail("no check made");
  store.insertCheckerTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: sub.id, checkId: check.id }, 3_000);
  store.bindTicket("verifier-1", "thr_verifier_1");
  store.insertFinalCheck(MANAGER, parent.id, { defaultBranch: "main", merged: [sub.id] }, 4_000);
  store.insertDecision(MANAGER, { question: "Which queue?", options: ["SQS", "Redis"], issueId: dependent.id }, 4_000);
  store.updateIssue(MANAGER, dependent.id, { decision: { text: "Retry three times", at: 4_100 } }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  for (const [change, at] of [[{ add: [parent.id], remove: [] }, 4_200], [{ add: [], remove: [parent.id] }, 4_300]] as const) {
    store.updateIssue(MANAGER, dependent.id, { dependsOn: { add: [...change.add], remove: [...change.remove] } }, { requireUnheld: false, closes: new Map(), at });
  }
  store.observeStatuses(MANAGER, [{ issue: dependent, status: "todo" }], 4_400);
  store.insertEvent(MANAGER, { kind: "unblocked", issueId: dependent.id, by: sub.id, closedAs: "done" }, 5_000);
  const asked = store.commentIssue(MANAGER, { issueId: dependent.id, author: { kind: "user" }, text: "Why three?", replyTo: null, submission: null }, 5_100) ?? assert.fail("not posted");
  store.commentIssue(MANAGER, { issueId: dependent.id, author: { kind: "manager" }, text: "It is enough.", replyTo: asked, submission: null }, 5_200);
  filedIssue(store, OTHER_MANAGER, newIssue(), 2_000);
  asBeforeKeys(db);
  return { db, store };
}

/** Every row of every table, to compare one state of the database with another. */
const everything = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]);

test("the fixture holds i-style issue ids, as a release before issue keys stored them", () => {
  const { db, store } = storedBy050();
  assert.deepEqual(db.prepare("SELECT id, parent_id AS parentId FROM issues WHERE coordinator_id = ? ORDER BY rowid").all(MANAGER), [{ id: "i1", parentId: null }, { id: "i2", parentId: "i1" }, { id: "i3", parentId: null }]);
  assert.deepEqual(store.unkeyedManagers(), [{ id: MANAGER, projectId: "prj_1" }]);
});

test("keying a regional manager renames every issue id it stores to KEY-N, the number kept, and only its own", () => {
  const { store } = storedBy050();
  assert.equal(store.keyIssues(MANAGER, BBP), true);

  assert.deepEqual(
    store.issues(MANAGER).map(({ id, parentId, dependsOn }) => ({ id, parentId, dependsOn })),
    [
      { id: "BBP-1", parentId: null, dependsOn: [] },
      { id: "BBP-2", parentId: "BBP-1", dependsOn: [] },
      { id: "BBP-3", parentId: null, dependsOn: ["BBP-2"] },
    ],
    "issues, parents and dependencies",
  );
  assert.deepEqual(store.agents(MANAGER).map(({ id, issueId }) => ({ id, issueId })), [{ id: "a1", issueId: "BBP-2" }], "agents, their own ids kept");
  const [handed = assert.fail("no handoff on BBP-2")] = store.record(MANAGER, id("BBP-2"));
  assert.equal(handed.handoff.issueId, "BBP-2", "handoffs");
  assert.equal(handed.check?.issueId, "BBP-2", "checks");
  assert.equal(handed.handoff.summary, "Retries land on i1", "text written before stays as written");
  assert.deepEqual(store.roleOfThread("thr_verifier_1"), { kind: "verifier", coordinatorId: MANAGER, issueId: "BBP-2", checkId: handed.check?.id }, "a verifier's role");
  assert.deepEqual(store.finalChecks(MANAGER, id("BBP-1")).map(({ issueId, subject }) => ({ issueId, subject })), [{ issueId: "BBP-1", subject: { kind: "final", defaultBranch: "main", merged: ["BBP-2"] } }], "final checks and the work they judge");
  assert.deepEqual(
    store.issueDecisions(MANAGER, id("BBP-3")).map((decision) => (decision.kind === "recorded" ? decision.text : decision.question)),
    ["Which queue?", "Retry three times"],
    "questions put to the user and decisions recorded",
  );
  assert.deepEqual(
    store.unannounced(MANAGER).map(({ event }) => event),
    [
      { kind: "unblocked", issueId: "BBP-3", by: "BBP-2", closedAs: "done" },
      { kind: "comment-to-you", issueId: "BBP-3", commentId: "m1" },
    ],
    "inbox events",
  );
  assert.deepEqual(store.commentsOf(MANAGER, id("BBP-3")).map(({ id: commentId, issueId, replyTo }) => ({ commentId, issueId, replyTo })), [
    { commentId: "m1", issueId: "BBP-3", replyTo: null },
    { commentId: "m2", issueId: "BBP-3", replyTo: "m1" },
  ], "comments");
  assert.deepEqual(
    store.logOf(MANAGER, id("BBP-3")).map(({ event }) => event),
    [{ kind: "dependency-added", on: "BBP-1" }, { kind: "dependency-removed", on: "BBP-1" }, { kind: "status", status: "todo" }],
    "an issue's log, and the issues it names",
  );
  assert.deepEqual([...store.issueWrites(MANAGER).keys()].sort(), ["BBP-1", "BBP-2", "BBP-3"], "each issue's write count");
  assert.deepEqual(store.unkeyedManagers(), []);

  assert.equal(filedIssue(store, MANAGER, newIssue(), 6_000).id, "BBP-4", "the next issue is numbered after them");
  assert.deepEqual(store.issues(OTHER_MANAGER).map(({ id }) => id), ["WEB-1"], "another manager's issues stay as they are");
});

test("keying again changes nothing, whatever key it names", () => {
  const { db, store } = storedBy050();
  store.keyIssues(MANAGER, BBP);
  const keyed = everything(db);
  assert.equal(store.keyIssues(MANAGER, BBP), false);
  assert.equal(store.keyIssues(MANAGER, issueKeySchema.parse("XYZ")), false);
  assert.deepEqual(everything(db), keyed);
});

test("a rename that fails undoes the key and every rename before it, and keying again then succeeds", () => {
  const { db, store } = storedBy050();
  const before = everything(db);
  // why roles: the verifier roles are renamed after the key is written and every issue column is renamed.
  const succeed = failWrites(db, "UPDATE", "roles");
  assert.throws(() => store.keyIssues(MANAGER, BBP), /forced failure/);
  assert.deepEqual(everything(db), before, "no table keeps any of it, the key included");
  assert.deepEqual(store.unkeyedManagers(), [{ id: MANAGER, projectId: "prj_1" }]);

  succeed();
  assert.equal(store.keyIssues(MANAGER, BBP), true);
  assert.deepEqual(store.issues(MANAGER).map(({ id }) => id), ["BBP-1", "BBP-2", "BBP-3"]);
  assert.deepEqual(store.roleOfThread("thr_verifier_1"), { kind: "verifier", coordinatorId: MANAGER, issueId: "BBP-2", checkId: store.record(MANAGER, id("BBP-2"))[0]?.check?.id });
});

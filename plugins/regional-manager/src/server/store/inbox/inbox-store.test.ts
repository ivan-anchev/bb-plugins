import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionIdSchema } from "../../../model/decision.ts";
import { closesOf } from "../../../model/issue/relations.ts";
import { issueViews, type IssueView } from "../../../model/issue/status.ts";
import type { PrSnapshot } from "../../../model/verdict/pr.ts";
import { failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER } from "../test-store.ts";

test("a decision may name the issue it flags, and is answered once", () => {
  const { store } = freshStore();
  const { id: issueId } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const named = store.insertDecision(MANAGER, { question: "Which queue?", options: ["SQS", "Redis"], issueId }, 3_000);
  const general = store.insertDecision(MANAGER, { question: "Ship on Friday?", options: [], issueId: null }, 3_100);

  assert.deepEqual(named, { id: "d1", issueId, question: "Which queue?", options: ["SQS", "Redis"], askedAt: 3_000, answer: null });
  assert.equal(general.issueId, null);
  assert.equal(store.answerDecision(MANAGER, named.id, "SQS", 4_000), "answered");
  assert.equal(store.answerDecision(MANAGER, named.id, "Redis", 4_100), "already-answered");
  assert.equal(store.answerDecision(OTHER_MANAGER, general.id, "Yes", 4_100), "unknown", "another manager's decision is not this one's");
  assert.equal(store.answerDecision(MANAGER, decisionIdSchema.parse("d9"), "Yes", 4_100), "unknown");
  assert.deepEqual(store.decisions(MANAGER).map(({ id, answer }) => [id, answer]), [["d1", { text: "SQS", at: 4_000 }], ["d2", null]]);
  assert.deepEqual(store.unannounced(MANAGER).map(({ event }) => event), [{ kind: "decision-answered", decisionId: named.id }]);
});

test("an answer that fails before the manager is told leaves the decision unanswered, and retried is answered and told once", () => {
  const { db, store } = freshStore();
  const decision = store.insertDecision(MANAGER, { question: "Which queue?", options: ["SQS", "Redis"], issueId: null }, 3_000);

  const restore = failWrites(db, "INSERT", "events");
  assert.throws(() => store.answerDecision(MANAGER, decision.id, "SQS", 4_000), /forced failure/);
  assert.equal(store.decision(decision.id)?.answer, null);
  assert.deepEqual(store.unannounced(MANAGER), []);

  restore();
  assert.equal(store.answerDecision(MANAGER, decision.id, "SQS", 4_100), "answered");
  assert.deepEqual(store.decision(decision.id)?.answer, { text: "SQS", at: 4_100 });
  assert.deepEqual(store.unannounced(MANAGER).map(({ event }) => event), [{ kind: "decision-answered", decisionId: decision.id }]);
});

test("a doorbell announces its events once; one that never reached its thread makes them unannounced again; a catch-up reads each once", () => {
  const { store } = freshStore();
  store.insertEvent(MANAGER, { kind: "coordinator-edited-files", fileCount: 2 }, 3_000);
  const [event] = store.unannounced(MANAGER);
  assert.deepEqual(store.coordinatorsToRing(), [MANAGER]);

  store.announce(MANAGER, [event!.id], "msg_1", 3_100);
  assert.deepEqual(store.coordinatorsToRing(), []);
  assert.deepEqual(store.doorbells(), [{ coordinatorId: MANAGER, threadId: "thr_manager_1", queuedMessageId: "msg_1" }]);

  store.reopenDoorbell("msg_1");
  assert.equal(store.doorbell(MANAGER), null);
  assert.deepEqual(store.unannounced(MANAGER), [event]);

  assert.deepEqual(store.takeUnread(MANAGER, 3_200), [event]);
  assert.deepEqual(store.takeUnread(MANAGER, 3_300), []);
});

test("a doorbell whose queued message fails to be kept leaves its events unannounced, and retried announces them", () => {
  const { db, store } = freshStore();
  store.insertEvent(MANAGER, { kind: "coordinator-edited-files", fileCount: 2 }, 3_000);
  const [event] = store.unannounced(MANAGER);

  const restore = failWrites(db, "INSERT", "doorbells");
  assert.throws(() => store.announce(MANAGER, [event!.id], "msg_1", 3_100), /forced failure/);
  assert.deepEqual(store.unannounced(MANAGER), [event]);
  assert.equal(store.doorbell(MANAGER), null);

  restore();
  store.announce(MANAGER, [event!.id], "msg_1", 3_100);
  assert.deepEqual(store.unannounced(MANAGER), []);
  assert.equal(store.doorbell(MANAGER), "msg_1");
});

test("a reopen that fails before its events are unannounced keeps the doorbell, and retried makes them unannounced", () => {
  const { db, store } = freshStore();
  store.insertEvent(MANAGER, { kind: "coordinator-edited-files", fileCount: 2 }, 3_000);
  const [event] = store.unannounced(MANAGER);
  store.announce(MANAGER, [event!.id], "msg_1", 3_100);

  const restore = failWrites(db, "UPDATE", "events");
  assert.throws(() => store.reopenDoorbell("msg_1"), /forced failure/);
  assert.equal(store.doorbell(MANAGER), "msg_1");
  assert.deepEqual(store.unannounced(MANAGER), []);

  restore();
  store.reopenDoorbell("msg_1");
  assert.equal(store.doorbell(MANAGER), null);
  assert.deepEqual(store.unannounced(MANAGER), [event]);
});

test("a reminder fires once when due; a repeating one moves to its next time", () => {
  const { store } = freshStore();
  const once = store.insertReminder(MANAGER, { note: "Check CI", dueAt: 5_000, everyMs: null });
  const daily = store.insertReminder(MANAGER, { note: "Stand-up", dueAt: 5_000, everyMs: 86_400_000 });
  assert.deepEqual(store.dueReminders(4_999), []);
  assert.deepEqual(store.dueReminders(5_000).map(({ id }) => id), [once.id, daily.id]);

  store.fireReminder(once.id, 5_000);
  store.fireReminder(once.id, 5_000);
  store.fireReminder(daily.id, 5_000);
  assert.deepEqual(store.reminders(MANAGER), [{ ...daily, dueAt: 5_000 + 86_400_000 }]);
  assert.deepEqual(store.unannounced(MANAGER).map(({ event }) => event.kind), ["reminder", "reminder"]);
  assert.deepEqual(store.cancelReminder(MANAGER, daily.id), { ...daily, dueAt: 5_000 + 86_400_000 });
});

test("the manager's own working tree is recorded once per state", () => {
  const { store } = freshStore();
  assert.equal(store.recordOwnTree(MANAGER, 0, 3_000), false);
  assert.equal(store.recordOwnTree(MANAGER, 2, 3_100), true);
  assert.equal(store.recordOwnTree(MANAGER, 2, 3_200), false);
  assert.equal(store.recordOwnTree(MANAGER, 0, 3_300), true);
  assert.deepEqual(store.lastOwnTreeEvent(MANAGER), { at: 3_300, event: { kind: "coordinator-tree-clean" } });
});

/** WEB-1 merged as #41 when `merged`, WEB-2 canceled by the manager, WEB-3 depending on them as stored: every issue of the manager as viewed with no agent. */
function mergedOrNot(store: ReturnType<typeof freshStore>["store"]) {
  const pr: PrSnapshot = { number: 41, url: "https://github.com/acme/webhooks/pull/41", state: "merged", draft: false, review: "none", ci: "pass", headSha: "0123456789abcdef0123456789abcdef01234567", failedChecks: [] };
  return (merged: boolean): IssueView[] => issueViews(store.issues(MANAGER).map((issue) => ({ issue, holder: null, ended: null, openDecision: false, finalCheck: null, verifierAsks: false, pr: merged && issue.id === "WEB-1" ? pr : null })));
}

/** The issues `views` says are unblocked since what is known, recorded, as "WEB-3 by WEB-1 done". */
function recorded(store: ReturnType<typeof freshStore>["store"], views: readonly IssueView[], at: number): string[] {
  store.recordUnblocked(MANAGER, views, at);
  return store.takeUnread(MANAGER, at).flatMap(({ event }) => (event.kind === "unblocked" ? [`${event.issueId} by ${event.by} ${event.closedAs}`] : []));
}

test("a relation knows its dependency's close from when it is written: kept through edits of the others, gone with it, and written afresh when added again", () => {
  const { store } = freshStore();
  const views = mergedOrNot(store);
  const [i1, i2] = [filedIssue(store, MANAGER, newIssue(), 2_000).id, filedIssue(store, MANAGER, newIssue(), 2_000).id];
  store.updateIssue(MANAGER, i2, { closed: { as: "canceled", at: 2_050 } }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  const i3 = filedIssue(store, MANAGER, newIssue({ dependsOn: [i1] }), 2_100).id;

  // WEB-1 merged while the manager added WEB-2: the read it was answered from already said so.
  store.updateIssue(MANAGER, i3, { dependsOn: { add: [i2], remove: [] } }, { requireUnheld: false, closes: closesOf(views(true)), at: 3_000 });
  assert.deepEqual(recorded(store, views(true), 3_000), ["WEB-3 by WEB-1 done"], "WEB-1 kept the close it knew, open");
  assert.deepEqual(recorded(store, views(true), 3_100), []);

  store.updateIssue(MANAGER, i3, { dependsOn: { add: [], remove: [i1] } }, { requireUnheld: false, closes: closesOf(views(false)), at: 3_000 });
  store.updateIssue(MANAGER, i3, { dependsOn: { add: [i1], remove: [] } }, { requireUnheld: false, closes: closesOf(views(false)), at: 3_000 });
  assert.deepEqual(recorded(store, views(true), 3_200), ["WEB-3 by WEB-1 done"], "added again while open, it knows nothing of its old close");
  store.updateIssue(MANAGER, i3, { dependsOn: { add: [], remove: [i1] } }, { requireUnheld: false, closes: closesOf(views(true)), at: 3_000 });
  store.updateIssue(MANAGER, i3, { dependsOn: { add: [i1], remove: [] } }, { requireUnheld: false, closes: closesOf(views(true)), at: 3_000 });
  assert.deepEqual(recorded(store, views(true), 3_300), [], "added again closed, it is no news");
});

test("an unblocked event that fails to be recorded takes what was learned back with it; the retry records it once", () => {
  const { db, store } = freshStore();
  const views = mergedOrNot(store);
  const i1 = filedIssue(store, MANAGER, newIssue(), 2_000).id;
  filedIssue(store, MANAGER, newIssue(), 2_000);
  filedIssue(store, MANAGER, newIssue({ dependsOn: [i1] }), 2_100);
  const known = () => db.prepare("SELECT issue_id, depends_on, known_close FROM issue_relations").all();
  const before = known();

  const allow = failWrites(db, "INSERT", "events");
  assert.throws(() => store.recordUnblocked(MANAGER, views(true), 3_000), /forced failure/);
  assert.deepEqual(known(), before);
  assert.deepEqual(store.unannounced(MANAGER), []);

  allow();
  assert.deepEqual(recorded(store, views(true), 3_100), ["WEB-3 by WEB-1 done"]);
  assert.deepEqual(recorded(store, views(true), 3_200), []);
});

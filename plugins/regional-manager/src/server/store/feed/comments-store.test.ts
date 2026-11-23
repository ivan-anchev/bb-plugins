import assert from "node:assert/strict";
import { test } from "node:test";
import { commentIdSchema, submissionIdSchema } from "../../../model/feed/comment.ts";
import { failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../test-store.ts";

const m1 = commentIdSchema.parse("m1");

test("a user's comment is stored with a comment-to-you event, together: a failed event write leaves neither, and the same call then succeeds", () => {
  const { db, store } = freshStore();
  const issueId = filedIssue(store, MANAGER, newIssue(), 1_000).id;
  const comment = { issueId, author: { kind: "user" }, text: "Use SQS, not Redis.", replyTo: null, submission: null } as const;
  const restore = failWrites(db, "INSERT", "events");

  assert.throws(() => store.commentIssue(MANAGER, comment, 2_000), /forced failure/);
  assert.deepEqual([store.commentsOf(MANAGER, issueId), store.unannounced(MANAGER)], [[], []]);

  restore();
  const id = store.commentIssue(MANAGER, comment, 2_000);
  assert.deepEqual(store.commentsOf(MANAGER, issueId), [{ id, issueId, at: 2_000, text: "Use SQS, not Redis.", replyTo: null, author: { kind: "user" } }]);
  assert.deepEqual(
    store.unannounced(MANAGER).map(({ event }) => event),
    [{ kind: "comment-to-you", issueId, commentId: id }],
  );
});

test("a submission posted again, as when its answer was lost, gets the same comment's id and writes nothing more; another submission is another comment", () => {
  const { store } = freshStore();
  const issueId = filedIssue(store, MANAGER, newIssue(), 1_000).id;
  const submission = submissionIdSchema.parse("0123456789abcdef0123456789abcdef");
  const comment = { issueId, author: { kind: "user" }, text: "Use SQS, not Redis.", replyTo: null, submission } as const;

  const first = store.commentIssue(MANAGER, comment, 2_000);
  assert.equal(store.commentIssue(MANAGER, comment, 2_100), first, "the retry answers the first comment's id");
  assert.deepEqual(store.commentsOf(MANAGER, issueId).map(({ id, at }) => [id, at]), [[first, 2_000]]);
  assert.equal(store.unannounced(MANAGER).length, 1, "one event, so one wake");

  const another = store.commentIssue(MANAGER, { ...comment, submission: submissionIdSchema.parse("fedcba9876543210fedcba9876543210") }, 2_200);
  assert.notEqual(another, first);
  assert.equal(store.commentsOf(MANAGER, issueId).length, 2);
  assert.equal(store.unannounced(MANAGER).length, 2);
});

test("the regional manager's reply records no event; an agent's records a comment event; each answers a comment of the same issue only", () => {
  const { store } = freshStore();
  const issueId = filedIssue(store, MANAGER, newIssue(), 1_000).id;
  const other = filedIssue(store, MANAGER, newIssue(), 1_000).id;
  const agentId = startAgent(store, issueId, "agent-1");
  const asked = store.commentIssue(MANAGER, { issueId, author: { kind: "user" }, text: "Why SQS?", replyTo: null, submission: null }, 2_000) ?? assert.fail("not stored");
  store.takeUnread(MANAGER, 2_100);

  const managers = store.commentIssue(MANAGER, { issueId, author: { kind: "manager" }, text: "It is already deployed.", replyTo: asked, submission: null }, 2_200);
  const agents = store.commentIssue(MANAGER, { issueId, author: { kind: "agent", agentId }, text: "SQS is wired.", replyTo: asked, submission: null }, 2_300);

  assert.deepEqual(store.unannounced(MANAGER).map(({ event }) => event), [{ kind: "comment", issueId, agentId, commentId: agents }]);
  assert.deepEqual(store.commentsOf(MANAGER, issueId).map(({ id, replyTo, author }) => ({ id, replyTo, author })), [
    { id: asked, replyTo: null, author: { kind: "user" } },
    { id: managers, replyTo: asked, author: { kind: "manager" } },
    { id: agents, replyTo: asked, author: { kind: "agent", agentId } },
  ]);
  assert.equal(store.commentIssue(MANAGER, { issueId: other, author: { kind: "manager" }, text: "Wrong issue.", replyTo: asked, submission: null }, 2_400), null, "a reply to another issue's comment");
  assert.equal(store.commentIssue(OTHER_MANAGER, { issueId, author: { kind: "manager" }, text: "Wrong manager.", replyTo: asked, submission: null }, 2_400), null, "a reply to another manager's comment");
  assert.deepEqual(store.commentsOf(MANAGER, other), []);
});

test("a regional manager removed takes its comments with it, and a comment reads back by its id", () => {
  const { store } = freshStore();
  const issueId = filedIssue(store, MANAGER, newIssue(), 1_000).id;
  const id = store.commentIssue(MANAGER, { issueId, author: { kind: "user" }, text: "Hold off.", replyTo: null, submission: null }, 2_000) ?? assert.fail("not stored");
  assert.equal(id, m1);
  assert.equal(store.comment(m1)?.text, "Hold off.");

  store.removeCoordinator(MANAGER);
  assert.equal(store.comment(m1), null);
});

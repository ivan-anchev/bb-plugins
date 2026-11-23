import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { wakes } from "../../model/inbox/inbox-event.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinating, HEAD, isRefusal, ISSUE, issueIn, settled, startedAgent, textOf } from "../test-harness.ts";

const DONE = { status: "done", summary: "Retries land", did: ["Added retries"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [], headSha: HEAD };

/** A regional manager, idle, with an agent at work on an issue, and the user's question on it, read in a catch-up. */
async function asked() {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  const issueId = issueIdSchema.parse(issue);
  kit.thread(threadId).status = "idle";
  const { commentId } = await kit.rpc.commentIssue({ coordinatorId, issueId, text: "Cap retries at five?" });
  await settled();
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  const comments = () => kit.store.commentsOf(coordinatorId, issueId).map(({ id, text, replyTo, author }) => ({ id, text, replyTo, author }));
  return { kit, threadId, coordinatorId, issueId, agentThreadId, commentId, comments, caughtUp, doorbells: () => kit.doorbellsSent(threadId) };
}

test("the regional manager's issue_comment posts its reply on the issue and tells it nothing; the holding agent's posts one and a comment event that wakes no one", async () => {
  const { kit, threadId, coordinatorId, issueId, agentThreadId, commentId, comments, caughtUp: told, doorbells } = await asked();
  assert.equal(doorbells().length, 1, "the user's comment woke the regional manager");
  assert.ok(told.includes(`Nothing reaches a1 on its own: the user's comments come to you.`), told);
  assert.ok(told.includes(`or, when it concerns a1's work, relay it with agent_message, quoting their words and naming ${commentId}, so it can answer on the issue. Never relay while ${issueId} is Reviewing or Verifying`), told);

  const managers = textOf(await kit.call("issue_comment", { issue: issueId, text: "Yes, five.", replyTo: commentId }, threadId));
  assert.equal(managers, `Posted m2 on ${issueId}. The user reads it on the issue's tab.`);
  assert.deepEqual(kit.store.unannounced(coordinatorId), [], "no inbox event for its own reply");

  const agents = textOf(await kit.call("issue_comment", { issue: issueId, text: "Capped at five in retry.ts.", replyTo: commentId }, agentThreadId));
  await settled();
  assert.equal(agents, `Posted m3 on ${issueId}. The user reads it on the issue's tab, and your regional manager in its next catch-up.`);
  const events = kit.store.unannounced(coordinatorId).map(({ event }) => event);
  assert.deepEqual(events, [{ kind: "comment", issueId, agentId: "a1", commentId: "m3" }]);
  assert.deepEqual(events.map(wakes), [false]);
  assert.equal(doorbells().length, 1, "the agent's comment rang no doorbell");

  assert.deepEqual(comments(), [
    { id: commentId, text: "Cap retries at five?", replyTo: null, author: { kind: "user" } },
    { id: "m2", text: "Yes, five.", replyTo: commentId, author: { kind: "manager" } },
    { id: "m3", text: "Capped at five in retry.ts.", replyTo: commentId, author: { kind: "agent", agentId: "a1" } },
  ]);
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.ok(caughtUp.includes(`### ${issueId} "Add retries" (a1) commented: m3\n\n`), caughtUp);
  assert.ok(caughtUp.includes(`It answers ${commentId}, the user's: "Cap retries at five?". In its own words:\n\nCapped at five in retry.ts.`), caughtUp);
});

test("an agent on another issue, a thread with no role, a reviewer, a verifier, an ended agent and another regional manager are refused issue_comment with the reason, and nothing is posted", async () => {
  const { kit, threadId, coordinatorId, issueId, agentThreadId, comments } = await asked();
  const before = comments();
  const comment = { issue: issueId, text: "Done here." };
  const refusal = async (threadId: string, input: object = comment) => {
    const result = await kit.call("issue_comment", input, threadId);
    assert.ok(isRefusal(result));
    return textOf(result);
  };

  const other = issueIn(textOf(await kit.call("issue_create", { ...ISSUE, title: "Dead letters" }, threadId)));
  assert.equal(await refusal(agentThreadId, { ...comment, issue: other }), `issue_comment is refused, and nothing was posted: you hold ${issueId}, not ${other}. Only an issue's regional manager, and the agent holding it now, comment on it.`);
  assert.equal(await refusal("thr_stranger"), "issue_comment is refused, and nothing was posted: this thread is not a regional manager, nor an agent of one. Only an issue's regional manager, and the agent holding it now, comment on it.");

  kit.reviewers.reportAtOnce = false;
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  await settled();
  const check = () => kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a1"))?.check ?? assert.fail("no check");
  const review = check().review;
  const reviewerThreadId = review.state === "running" ? review.reviewerThreadId : assert.fail(`no reviewer running: ${JSON.stringify(review)}`);
  assert.equal(await refusal(reviewerThreadId), `issue_comment is refused, and nothing was posted: this thread is a reviewer of ${issueId}, and reports only through its own tool. Only an issue's regional manager, and the agent holding it now, comment on it.`);
  await kit.call("issue_review", { findings: [] }, reviewerThreadId);
  await kit.idle(reviewerThreadId, "Reviewed.");
  await settled();
  const verdict = check().verdict;
  const verifierThreadId = verdict?.state === "running" ? verdict.verifierThreadId : assert.fail(`no verifier running: ${JSON.stringify(verdict)}`);
  const byVerifier = await kit.call("issue_comment", comment, verifierThreadId);
  assert.ok(isRefusal(byVerifier));
  assert.equal(textOf(byVerifier), `issue_comment is refused, and nothing was posted: this thread is a verifier of ${issueId}, and reports only through its own tool. Only an issue's regional manager, and the agent holding it now, comment on it.`);

  const second = await kit.startManager("Ship the billing service", { verify: true });
  const byOther = await kit.call("issue_comment", comment, second.threadId);
  assert.ok(isRefusal(byOther));
  assert.equal(textOf(byOther), `issue_comment is refused, and nothing was posted: you have no issue ${issueId}. crew_catch_up lists your issues.`);

  await kit.call("agent_stop", { agent: "a1" }, threadId);
  const byEnded = await kit.call("issue_comment", comment, agentThreadId);
  assert.ok(isRefusal(byEnded));
  assert.equal(textOf(byEnded), `issue_comment is refused, and nothing was posted: you no longer hold ${issueId} (you were stopped). Only an issue's regional manager, and the agent holding it now, comment on it.`);

  const elsewhere = await kit.call("issue_comment", { ...comment, replyTo: "m9" }, threadId);
  assert.equal(textOf(elsewhere), `issue_comment is refused, and nothing was posted: m9 is no comment on ${issueId}. Leave replyTo out, or give a comment of ${issueId}'s.`);
  assert.deepEqual(comments(), before);

  // The refusal's way forward: the same comment with replyTo left out posts.
  assert.equal(textOf(await kit.call("issue_comment", comment, threadId)), `Posted m2 on ${issueId}. The user reads it on the issue's tab.`);
  assert.deepEqual(comments(), [...before, { id: "m2", text: "Done here.", replyTo: null, author: { kind: "manager" } }]);
});

// The three answers to the plugin's question at an issue's cap, end to end: the options it offers,
// what each answer tells the regional manager, and what merging the issue as it is allows after.
import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "../../contract.ts";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { decisionIdSchema } from "../../model/decision.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { coordinating, failsVerification, HEAD, isRefusal, settled, startedAgent, textOf, threadIn, toCap } from "../test-harness.ts";

type Kit = Awaited<ReturnType<typeof coordinating>>["kit"];

const d1 = decisionIdSchema.parse("d1");
const a2 = agentIdSchema.parse("a2");
const MERGE = "Merge as is, file follow-ups";
const MUST_FIX = { file: "src/retry.ts", line: 42, severity: "must-fix", claim: "The backoff never caps." };
const SHOULD_FIX = { file: "src/retry.ts", line: 7, severity: "should-fix", claim: "The jitter is computed twice." };

/**
 * A regional manager whose issue WEB-1 reached its cap: its agent a1 failed verification twice, then
 * a fresh agent a2 handed off done on pull request #41, and its reviewer reported a must-fix and a
 * should-fix, which the verifier upheld while every criterion passed, so the must-fix failed it.
 */
async function capped() {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await failsVerification(kit, coordinatorId, agentThreadId);
  await failsVerification(kit, coordinatorId, agentThreadId);
  const fresh = threadIn(textOf(await kit.call("agent_start", { issue }, threadId)));
  await openPr(kit, fresh, "OPEN");
  await failsOnMustFix(kit, coordinatorId, fresh, { findings: [MUST_FIX, SHOULD_FIX] }, [ANCHORED, { finding: 2, result: "confirmed", reason: "Both calls sit on line 7." }]);
  kit.thread(threadId).status = "idle";
  const catchUp = async () => textOf(await kit.call("crew_catch_up", {}, threadId));
  return { kit, threadId, coordinatorId, fresh, catchUp };
}

/** The verifier's word on MUST_FIX: it holds, and breaks the brief. */
const ANCHORED = { finding: 1, result: "anchored", anchor: "brief", reason: "The brief says retries back off; this never stops doubling." };

/** a2, in `agentThreadId`, hands off done, its reviewer reports `review`, and its verifier passes every criterion but triages as `triage`, so an anchored finding fails it. */
async function failsOnMustFix(kit: Kit, coordinatorId: CoordinatorId, agentThreadId: string, review: object, triage: readonly object[]): Promise<void> {
  const check = () => kit.store.latestHandoff(coordinatorId, a2)?.check ?? assert.fail("no check");
  kit.reviewers.reportAtOnce = false;
  await kit.call("agent_handoff", { status: "done", summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  await settled();
  const reviewing = check().review;
  const reviewer = reviewing.state === "running" ? reviewing.reviewerThreadId : assert.fail(`the review is ${reviewing.state}`);
  assert.match(textOf(await kit.call("issue_review", review, reviewer)), /^Review recorded/);
  await kit.idle(reviewer, "Reviewed.");
  await settled();
  const { verdict, criteria } = check();
  const verifier = verdict.state === "running" ? verdict.verifierThreadId : assert.fail(`the verdict is ${verdict.state}`);
  const passes = criteria.map((_, i) => ({ criterion: i + 1, result: "pass", evidence: "# pass" }));
  assert.match(textOf(await kit.call("issue_verdict", { criteria: passes, findings: [], triage }, verifier)), /^Verdict recorded/);
  await kit.idle(verifier, "Verdict returned.");
  await settled();
  kit.reviewers.reportAtOnce = true;
}

/** GitHub reports pull request #41, in `state`, on the branch of the agent in `agentThreadId`, and the PR watch reads it. */
async function openPr(kit: Kit, agentThreadId: string, state: "OPEN" | "MERGED"): Promise<void> {
  const branch = kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch");
  kit.github.prs.set(branch, { number: 41, state, isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  kit.clock.now += 5 * 60_000; // why five minutes: the PR watch polls a quiet pull request no more often.
  await kit.tick();
  await settled();
}

test("a third failed verification asks the user with three options, in order: merge as is filing follow-ups, one more round, and cancel the issue; its question names all three", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await toCap(kit, threadId, coordinatorId, issue, agentThreadId);

  const board = coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId }));
  const [asked = assert.fail("nothing asked"), ...more] = board.decisions;
  assert.deepEqual(more, []);
  assert.deepEqual(asked.options, [MERGE, "One more round", "Cancel the issue"]);
  assert.match(asked.question, /^✗ Failed verification, 0 of 1 criteria passed\. WEB-1 has failed verification 3 times, its cap, and nothing goes back to an agent until you answer: merge it as is and file its open findings as a follow-up, give it one more round, or cancel it and close its pull request\.$/);
});

test("answering merge as is after a failure on review findings alone tells the regional manager to accept it as it is, which files the follow-up, then have the PR merged with no further round; agent_start is then allowed", async () => {
  const { kit, threadId, coordinatorId, catchUp } = await capped();
  await catchUp();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();

  assert.match(kit.doorbellsSent(threadId).at(-1) ?? "", /- The user answered d1, the plugin's question at WEB-1's cap: merge it as is, with no further round, and file its open must-fix findings as a follow-up$/);
  const answered = /### The user answered d1[^]*?(?=\n### |\n## |$)/.exec(await catchUp())?.[0] ?? assert.fail("no answer in the catch-up");
  assert.match(answered, /^### The user answered d1, the plugin's question at WEB-1's cap\n\nAt \S+ It asked: ✗ A must-fix review finding upheld, 1 of 1 criteria passed\. [^\n]+ It offered: "Merge as is, file follow-ups", "One more round", "Cancel the issue"\. They chose "Merge as is, file follow-ups"\.\n\n/);
  assert.match(answered, /They chose to merge WEB-1 as it is, so it gets no further round\. Its last failure was on review findings alone, so first accept it as it is: issue_update \{ id: "WEB-1", status: "in-review", decision: "<their answer, and why>" \} puts it In review until its pull request merges, and files the findings it leaves, its open must-fix findings among them, as one follow-up\. File no other follow-up\. Have its pull request #41 merged without another review or verifier: ask its agent to merge it with agent_message, or, when no agent holds WEB-1, start one with agent_start, with no from or placement, so it continues in its last agent's environment on that pull request's branch\. agent_start on a new branch is refused while this answer stands, as that pull request would be left behind\. Never merge it yourself; its merge makes WEB-1 Done\./);
  assert.doesNotMatch(answered, /issue_create/, "the accept files the follow-up");
  assert.match(textOf(await kit.call("agent_start", { issue: "WEB-1" }, threadId)), /^Stopped a2 and started a3 on WEB-1 as @thread:\w+ in a2's worktree, on its branch `bb\/thr_\d+`, with PR #41/, "agent_start is allowed, continuing on the pull request's branch, for an agent to merge it");
});

test("after the merge answer, agent_message on the issue is allowed, a later failed done handoff goes back to no agent and asks nothing, and the merge makes the issue Done", async () => {
  const { kit, threadId, coordinatorId, fresh, catchUp } = await capped();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  await catchUp();

  const message = await kit.call("agent_message", { agent: "a2", text: "Merge #41 as it is." }, threadId);
  assert.ok(!isRefusal(message), textOf(message));
  assert.match(textOf(message), /^(Sent to|Queued for) a2\./);
  const sentBefore = kit.sent().length;
  // why the reviewer answers the earlier must-fix: a later round's review covers only the change since, and answers that round's blocking findings.
  await failsOnMustFix(kit, coordinatorId, fresh, { findings: [], earlier: [{ finding: 1, fixed: false, note: "The backoff still never caps." }] }, [ANCHORED]);

  const fourth = kit.store.latestHandoff(coordinatorId, a2)?.check?.verdict;
  assert.equal(fourth?.state === "returned" && fourth.settlement.kind, "checked", "settled as checked, never sent back");
  assert.deepEqual(kit.sent().slice(sentBefore).filter((args) => args.threadId === fresh), [], "a2's findings went back to it nowhere");
  assert.equal(kit.store.agent(coordinatorId, a2)?.fixRounds, 0, "no round was spent");
  assert.deepEqual(kit.store.decisions(coordinatorId).map(({ id, answer }) => [id, answer?.text ?? null]), [["d1", MERGE]], "and nothing more was asked");
  const later = await catchUp();
  assert.match(later, /Nothing went back to an agent: the user chose to merge WEB-1 as it is \(d1\), which allows no further round, so this failure files no follow-up of its own\. Have its pull request #41 merged without another review or verifier/);
  assert.doesNotMatch(later, /issue_create/, "the answer's update filed the one follow-up");

  await openPr(kit, fresh, "MERGED");
  const status = coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId })).issues.find(({ id }) => id === "WEB-1")?.status;
  assert.equal(status, "done");
});

test("the merge answer's accept, followed as its update says, puts the issue In review with one follow-up holding the open must-fix and the should-fix, and the merge makes it Done", async () => {
  const { kit, threadId, coordinatorId, fresh, catchUp } = await capped();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  await catchUp();
  const accepted = await kit.call("issue_update", { id: "WEB-1", status: "in-review", decision: "The user chose to merge it as is (d1)." }, threadId);
  assert.ok(!isRefusal(accepted), textOf(accepted));
  assert.match(textOf(accepted), /are filed as \[WEB-2\]/);
  const board = async () => coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId }));
  const row = async () => (await board()).issues.find(({ id }) => id === "WEB-1");
  assert.equal((await row())?.status, "in-review");
  assert.match((await row())?.headline ?? "", /^Accepted with follow-ups: /);
  const brief = kit.store.issues(coordinatorId).find(({ id }) => id === "WEB-2")?.brief ?? assert.fail("no follow-up");
  assert.match(brief, /`src\/retry\.ts:42` \(must-fix\): The backoff never caps\./);
  assert.match(brief, /`src\/retry\.ts:7` \(should-fix\): The jitter is computed twice\./);

  await openPr(kit, fresh, "MERGED");
  assert.equal((await row())?.status, "done");
});

test("a merge answer after a review-only failure whose commit's CI has since failed keeps the manual follow-up, as the accept would be refused", async () => {
  const { kit, threadId, coordinatorId, fresh, catchUp } = await capped();
  const branch = kit.thread(fresh).environmentBranchName ?? assert.fail("no branch");
  kit.github.prs.set(branch, { number: 41, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: "FAILURE", failed: ["test"] });
  kit.clock.now += 5 * 60_000;
  await kit.tick();
  await settled();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  const answered = /### The user answered d1[^]*?(?=\n### |\n## |$)/.exec(await catchUp())?.[0] ?? assert.fail("no answer in the catch-up");
  assert.doesNotMatch(answered, /status: "in-review"/, "no accept is offered");
  assert.match(answered, /File the open must-fix findings of its last failed verdict as one follow-up issue with issue_create, listing each:\n\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps\./);
  const accept = await kit.call("issue_update", { id: "WEB-1", status: "in-review", decision: "The user chose to merge it as is (d1)." }, threadId);
  assert.ok(isRefusal(accept), "the accept the update didn't offer is refused");
  assert.match(textOf(accept), /^CI failed on #41 at 0123456/);
});

test("a merge answer read after its pull request merged offers no accept and no merge: it files the failed round's must-fix findings with issue_create", async () => {
  const { kit, coordinatorId, fresh, catchUp } = await capped();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  await openPr(kit, fresh, "MERGED");
  const answered = /### The user answered d1[^]*?(?=\n### |\n## |$)/.exec(await catchUp())?.[0] ?? assert.fail("no answer in the catch-up");
  assert.match(answered, /They chose to merge WEB-1 as it is, so it gets no further round\. Its pull request #41 has merged since, which made WEB-1 Done, so nothing is left to merge\. File the open must-fix findings of its last failed verdict as one follow-up issue with issue_create, listing each:\n\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps\./);
  assert.doesNotMatch(answered, /status: "in-review"|Have its pull request/);
});

test("a merge answer read after the manager accepted the failure, which filed the follow-up, and the pull request merged names that follow-up and offers no second filing", async () => {
  const { kit, threadId, coordinatorId, fresh, catchUp } = await capped();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  const accepted = await kit.call("issue_update", { id: "WEB-1", status: "in-review", decision: "The user chose to merge it as is (d1)." }, threadId);
  assert.match(textOf(accepted), /are filed as \[WEB-2\]/);
  await openPr(kit, fresh, "MERGED");

  const answered = /### The user answered d1[^]*?(?=\n### |\n## |$)/.exec(await catchUp())?.[0] ?? assert.fail("no answer in the catch-up");
  assert.match(answered, /They chose to merge WEB-1 as it is, so it gets no further round\. Its pull request #41 has merged since, which made WEB-1 Done, so nothing is left to merge\. Your accept of WEB-1's last failure filed its open must-fix findings as WEB-2, the one follow-up this answer files, so file no other\./);
  assert.doesNotMatch(answered, /issue_create|status: "in-review"/);
  assert.deepEqual(kit.store.issues(coordinatorId).map(({ id }) => id), ["WEB-1", "WEB-2"], "one follow-up");
});

test("a merge answer read after the manager accepted the failure, its pull request still open, names the filed follow-up and asks only for the merge", async () => {
  const { kit, threadId, coordinatorId, catchUp } = await capped();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  await kit.call("issue_update", { id: "WEB-1", status: "in-review", decision: "The user chose to merge it as is (d1)." }, threadId);

  const answered = /### The user answered d1[^]*?(?=\n### |\n## |$)/.exec(await catchUp())?.[0] ?? assert.fail("no answer in the catch-up");
  assert.match(answered, /They chose to merge WEB-1 as it is, so it gets no further round\. Have its pull request #41 merged without another review or verifier: [^\n]+ Never merge it yourself; its merge makes WEB-1 Done\. Your accept of WEB-1's last failure filed its open must-fix findings as WEB-2, the one follow-up this answer files, so file no other\./);
  assert.doesNotMatch(answered, /issue_create|status: "in-review"/, "neither a second filing nor an accept, which would be refused");
});

test("answering one more round or cancel the issue gives each its own guidance: a round to direct, or stop, close the PR and cancel", async () => {
  const round = await capped();
  await round.catchUp();
  await round.kit.rpc.answerDecision({ coordinatorId: round.coordinatorId, decisionId: d1, answer: "One more round" });
  await settled();
  assert.match(round.kit.doorbellsSent(round.threadId).at(-1) ?? "", /- The user answered d1, the plugin's question at WEB-1's cap: one more round$/);
  assert.match(await round.catchUp(), /They chose one more round for WEB-1: tell its agent what to fix with agent_message, or hand WEB-1 to a fresh agent with agent_start\. If that round fails verification too, the plugin asks them again\./);

  const cancel = await capped();
  await cancel.catchUp();
  await cancel.kit.rpc.answerDecision({ coordinatorId: cancel.coordinatorId, decisionId: d1, answer: "Cancel the issue" });
  await settled();
  assert.match(cancel.kit.doorbellsSent(cancel.threadId).at(-1) ?? "", /- The user answered d1, the plugin's question at WEB-1's cap: stop its agent, close its pull request and cancel it$/);
  const text = await cancel.catchUp();
  assert.match(text, /They chose to cancel WEB-1: stop its agent with agent_stop, if one holds it; close its pull request #41 with `gh pr close 41`; and cancel WEB-1 with issue_update \(status "canceled"\)\./);
  assert.doesNotMatch(text, /no further round|one more round for/);
});

test("answered before the manager read the failure that asked, the merge answer still orders one accept: that failure's update points at the answer and files none", async () => {
  const { kit, coordinatorId, catchUp } = await capped();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  const text = await catchUp();
  assert.match(text, /This was WEB-1's 3rd failed verification, its cap: nothing went back to an agent, and the plugin asked the user \(d1\)\. Nothing went back to an agent: the user chose to merge WEB-1 as it is \(d1\), which allows no further round, so this failure files no follow-up of its own\./);
  assert.equal(text.match(/status: "in-review"/g)?.length, 1, "one order to accept it, which files the follow-up, in the answer's update");
  assert.doesNotMatch(text, /issue_create/);
});

test("a merge answer on a failure with no must-fix finding files no follow-up", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await toCap(kit, threadId, coordinatorId, issue, agentThreadId);
  kit.thread(threadId).status = "idle";
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(text, /They chose to merge WEB-1 as it is, so it gets no further round\. Have its pull request, if it has one, merged without another review or verifier: [^\n]+ Its last failed verdict upheld no must-fix finding, so there is no follow-up to file\./);
  assert.doesNotMatch(text, /issue_create/);
});

test("while the merge answer stands, agent_start on a new branch is refused, as the pull request would be left behind, and the merge of that pull request still makes the issue Done", async () => {
  const { kit, threadId, coordinatorId, fresh } = await capped();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();
  const why = "Nothing changed. The user chose to merge WEB-1 as it is (d1), so an agent starts on it only in its last agent's environment, on its pull request's branch: on a new branch, that pull request would be left behind and its merge wouldn't make WEB-1 Done.";

  assert.equal(textOf(await kit.call("agent_start", { issue: "WEB-1", from: "default" }, threadId)), `agent_start is refused: ${why} Start one with no from or placement.`);
  assert.match(textOf(await kit.call("agent_stop", { agent: "a2" }, threadId)), /^a2 is stopped; it no longer holds WEB-1\./);
  kit.thread(fresh).archivedAt = kit.clock.now;
  kit.environments.destroyed.add(kit.environment(fresh)); // bb environment cleanup: the worktree goes, its branch stays
  await kit.tick();
  assert.equal(textOf(await kit.call("agent_start", { issue: "WEB-1" }, threadId)), `agent_start is refused: ${why} bb has removed that environment, so no agent can continue there: ask the user to merge the pull request themselves, which makes WEB-1 Done.`);
  assert.deepEqual(kit.store.agents(coordinatorId).map(({ id }) => id), ["a1", "a2"], "no agent was started");

  await openPr(kit, fresh, "MERGED");
  assert.equal(coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId })).issues.find(({ id }) => id === "WEB-1")?.status, "done");
});

test("answering cancel before the plugin read any pull request names the issue's branch to close it by", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  const fresh = await toCap(kit, threadId, coordinatorId, issue, agentThreadId);
  kit.thread(threadId).status = "idle";
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "Cancel the issue" });
  await settled();
  const branch = kit.thread(fresh).environmentBranchName ?? assert.fail("no branch");
  assert.ok(textOf(await kit.call("crew_catch_up", {}, threadId)).includes(`close its pull request, if one is open on its branch, with \`gh pr close ${branch}\`; and cancel WEB-1`));
});

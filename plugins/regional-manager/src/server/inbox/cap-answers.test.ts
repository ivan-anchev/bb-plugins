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

test("answering merge as is tells the regional manager to have the PR merged with no further round and to file the last verdict's open must-fix findings as one follow-up, listing them; agent_start is then allowed", async () => {
  const { kit, threadId, coordinatorId, catchUp } = await capped();
  await catchUp();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: MERGE });
  await settled();

  assert.match(kit.doorbellsSent(threadId).at(-1) ?? "", /- The user answered d1, the plugin's question at WEB-1's cap: merge it as is, with no further round, and file its open must-fix findings as a follow-up$/);
  const answered = /### The user answered d1[^]*?(?=\n### |\n## |$)/.exec(await catchUp())?.[0] ?? assert.fail("no answer in the catch-up");
  assert.match(answered, /^### The user answered d1, the plugin's question at WEB-1's cap\n\nAt \S+ It asked: ✗ A must-fix review finding upheld, 1 of 1 criteria passed\. [^\n]+ It offered: "Merge as is, file follow-ups", "One more round", "Cancel the issue"\. They chose "Merge as is, file follow-ups"\.\n\n/);
  assert.match(answered, /They chose to merge WEB-1 as it is: WEB-1 gets no further round\. Have its pull request #41 merged without another review or verifier: ask its agent to merge it with agent_message, or, when no agent holds WEB-1, start one with agent_start to do only that\. Never merge it yourself; the merge makes WEB-1 Done\./);
  assert.match(answered, /File the open must-fix findings of its last failed verdict as one follow-up issue with issue_create, listing each:\n\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps\.\n*$/);
  assert.doesNotMatch(answered, /jitter/, "a should-fix that held is no must-fix, so it isn't listed");
  assert.match(textOf(await kit.call("agent_start", { issue: "WEB-1" }, threadId)), /^Stopped a2 and started a3 on WEB-1/, "agent_start is allowed, for an agent to merge it");
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
  assert.match(await catchUp(), /Nothing went back to an agent: the user chose to merge WEB-1 as it is \(d1\)\. WEB-1 gets no further round\. Have its pull request #41 merged without another review or verifier/);

  await openPr(kit, fresh, "MERGED");
  const status = coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId })).issues.find(({ id }) => id === "WEB-1")?.status;
  assert.equal(status, "done");
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
  assert.match(cancel.kit.doorbellsSent(cancel.threadId).at(-1) ?? "", /- The user answered d1, the plugin's question at WEB-1's cap: cancel it and close its pull request$/);
  const text = await cancel.catchUp();
  assert.match(text, /They chose to cancel WEB-1: stop its agent with agent_stop, if one holds it; close its pull request #41 with `gh pr close 41`; and cancel WEB-1 with issue_update \(status "canceled"\)\./);
  assert.doesNotMatch(text, /no further round|one more round for/);
});

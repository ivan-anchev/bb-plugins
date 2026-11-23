// The statuses an issue moves to, as the view watch observes them through the tools, the threads'
// turns and the tick: each logged once as it is seen, on a read no change overtook, never replayed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../../model/agent/agent.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import { coordinating, HEAD, settled, startedAgent, textOf } from "../../test-harness.ts";

const WEB_1 = issueIdSchema.parse("WEB-1");
const A1 = agentIdSchema.parse("a1");
const DONE = { status: "done", summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: HEAD };
const PASSES = { criteria: [{ criterion: 1, result: "pass", evidence: "$ npm test\n# pass 13" }], findings: [] };

/** A regional manager with one agent on WEB-1, and the statuses WEB-1's log holds, in order. */
async function watched() {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId, { doneCriteria: ["npm test passes"] });
  kit.thread(threadId).status = "idle";
  await settled();
  const statuses = () => kit.store.logOf(coordinatorId, WEB_1).flatMap(({ event }) => (event.kind === "status" ? [event.status] : []));
  const verifier = (): string => {
    const verdict = kit.store.latestHandoff(coordinatorId, A1)?.check?.verdict;
    return verdict?.state === "running" ? verdict.verifierThreadId : assert.fail(`the verdict is ${verdict?.state}`);
  };
  return { kit, threadId, coordinatorId, agentThreadId, statuses, verifier };
}

test("a done handoff's statuses are logged once each, in order, as its turn ends and its verifier runs; the same views again log nothing", async () => {
  const { kit, coordinatorId, agentThreadId, statuses, verifier } = await watched();
  assert.deepEqual(statuses(), ["todo", "in-progress"], "filed, then the agent at work as it started");

  await kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  assert.deepEqual(statuses(), ["todo", "in-progress"], "the turn that handed off still runs");
  await kit.idle(agentThreadId, "Handed off.");
  await settled();
  verifier();
  assert.deepEqual(statuses(), ["todo", "in-progress", "reviewing", "verifying"], "Reviewing as the turn ended, Verifying once its reviewer reported and its verifier runs");

  await kit.tick();
  await settled();
  assert.deepEqual(statuses(), ["todo", "in-progress", "reviewing", "verifying"], "a tick reading the same views logs nothing more");
  const issue = kit.store.issue(coordinatorId, WEB_1) ?? assert.fail("no WEB-1");
  assert.equal(kit.store.observeStatuses(coordinatorId, [{ issue, status: "verifying" }], kit.clock.now), 0);
});

test("a read a change overtook logs nothing on its pass; the next read no change overtakes logs the move once", async () => {
  const { kit, threadId, agentThreadId, statuses, verifier } = await watched();
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  await settled();
  const before = statuses();
  assert.deepEqual(before, ["todo", "in-progress", "reviewing", "verifying"]);

  const verifierThreadId = verifier();
  kit.threadLists.holding = true;
  const verdict = kit.call("issue_verdict", PASSES, verifierThreadId);
  // why release until it answers: the tool reads bb itself before it writes; the watch's read, started by its write, is held after.
  while (!(await Promise.race([verdict.then(() => true), settled().then(() => false)]))) kit.threadLists.held.splice(0).forEach((release) => release());
  assert.match(textOf(await verdict), /^Verdict recorded/);
  await settled();
  // Each read of bb answers only after the manager changed the plan again: a write between the read and the act. why 3: the reads one pass makes before it gives up (current-views.ts READS).
  for (let round = 0; round < 3; round++) {
    await settled();
    assert.ok(kit.threadLists.held.length > 0, `pass ${round}: the watch's read is held`);
    assert.match(textOf(await kit.call("issue_update", { id: "WEB-1", title: `Add retries, round ${round}` }, threadId)), /^Updated WEB-1/);
    kit.threadLists.held.splice(0).forEach((release) => release());
    await settled();
    assert.deepEqual(statuses(), before, `pass ${round}: an overtaken read logged nothing`);
  }
  kit.threadLists.holding = false;
  while (kit.threadLists.held.length > 0) {
    kit.threadLists.held.splice(0).forEach((release) => release());
    await settled();
  }
  await kit.tick();
  await settled();
  assert.deepEqual(statuses(), [...before, "in-review"]);
});

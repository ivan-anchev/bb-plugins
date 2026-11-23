// The statuses an issue moves to, as the view watch observes them through the tools, the threads'
// turns and the tick: each logged once as it is seen, on a read no change overtook, never replayed.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Coordinator } from "../../../contract.ts";
import { agentIdSchema } from "../../../model/agent/agent.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import type { IssueView } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { AVATAR, MANAGER, OTHER_MANAGER } from "../../store/test-store.ts";
import { coordinating, HEAD, settled, startedAgent, textOf } from "../../test-harness.ts";
import { watchViews } from "./view-watch.ts";

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
  // Each read of bb answers only after the manager changed the plan again: a write between the read
  // and the act. why until none is held: a pass makes so many reads before it gives up (current-views.ts READS).
  let rounds = 0;
  for (; kit.threadLists.held.length > 0; rounds++) {
    assert.match(textOf(await kit.call("issue_update", { id: "WEB-1", title: `Add retries, round ${rounds}` }, threadId)), /^Updated WEB-1/);
    kit.threadLists.held.splice(0).forEach((release) => release());
    await settled();
    assert.deepEqual(statuses(), before, `pass ${rounds}: an overtaken read logged nothing`);
  }
  assert.ok(rounds > 0, "a read was overtaken");
  kit.threadLists.holding = false;
  await kit.tick();
  await settled();
  assert.deepEqual(statuses(), [...before, "in-review"]);
});

test("a regional manager whose read bb never answers holds no other: the tick reads every manager side by side, and goes on after its wait", async () => {
  const manager = (id: CoordinatorId, n: number): Coordinator => ({ id, threadId: `thr_manager_${n}`, projectId: "prj_1", description: null, avatar: AVATAR });
  const read: CoordinatorId[] = [];
  const published: CoordinatorId[] = [];
  const unanswered = new Promise<never>(() => {});
  const watch = watchViews(
    {
      bb: { log: { warn: () => {} }, onDispose: () => {} },
      store: { coordinators: () => [manager(MANAGER, 1), manager(OTHER_MANAGER, 2)], observeStatuses: () => 1 },
      views: {
        async whileCurrent<R>(id: CoordinatorId, act: (views: IssueView[]) => R): Promise<{ acted: R } | null> {
          read.push(id);
          if (id === MANAGER) return unanswered;
          return { acted: act([]) };
        },
      },
      inbox: { unblocked: () => {} },
      publish: (id) => void published.push(id),
      now: () => 1_000,
    },
    50,
  );

  await watch.tick();
  assert.deepEqual(read, [MANAGER, OTHER_MANAGER], "the second manager is read while the first's read is out");
  assert.deepEqual(published, [OTHER_MANAGER], "and what it logged is published");
  await watch.tick();
  assert.deepEqual(read, [MANAGER, OTHER_MANAGER, OTHER_MANAGER], "the next tick reads the others again, and leaves the first's one read running");
});

test("a review reported while its reviewer still runs logs Verifying as the report is written, with no tick", async () => {
  const { kit, coordinatorId, agentThreadId, statuses } = await watched();
  kit.reviewers.reportAtOnce = false;
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  await settled();
  assert.deepEqual(statuses(), ["todo", "in-progress", "reviewing"]);
  const review = kit.store.latestHandoff(coordinatorId, A1)?.check?.review;
  const reviewerThreadId = review?.state === "running" ? review.reviewerThreadId : assert.fail(`the review is ${review?.state}`);

  assert.match(textOf(await kit.call("issue_review", { findings: [] }, reviewerThreadId)), /^Review recorded/);
  await settled();
  assert.equal(kit.thread(reviewerThreadId).status, "active", "its turn still runs");
  assert.deepEqual(statuses(), ["todo", "in-progress", "reviewing", "verifying"]);
});

/** A watch over one regional manager whose reads the test answers, in `reads`, with views or an error; each act is counted in `logged`, then runs `onAct`. */
function heldWatch(tickWaitMs = 50) {
  const reads: ((views: IssueView[] | Error) => void)[] = [];
  const warnings: string[] = [];
  const logged: number[] = [];
  const acting = { onAct: (): void => {} };
  const watch = watchViews(
    {
      bb: { log: { warn: (warning) => void warnings.push(warning) }, onDispose: () => {} },
      store: {
        coordinators: () => [{ id: MANAGER, threadId: "thr_manager_1", projectId: "prj_1", description: null, avatar: AVATAR }],
        observeStatuses: () => {
          logged.push(logged.length);
          acting.onAct();
          return 1;
        },
      },
      views: {
        async whileCurrent<R>(_id: CoordinatorId, act: (views: IssueView[]) => R): Promise<{ acted: R } | null> {
          const answer = await new Promise<IssueView[] | Error>((resolve) => reads.push(resolve));
          if (answer instanceof Error) throw answer;
          return { acted: act(answer) };
        },
      },
      inbox: { unblocked: () => {} },
      publish: () => {},
      now: () => 1_000,
    },
    tickWaitMs,
  );
  return { watch, reads, warnings, logged, acting };
}

test("a change told as a read's pass acts is read again, not left for the tick", async () => {
  const { watch, reads, logged, acting } = heldWatch();
  watch.changed(MANAGER);
  await settled();
  // why in the act: the pass has recorded what it read, and has yet to return.
  acting.onAct = () => {
    acting.onAct = () => {};
    watch.changed(MANAGER);
  };
  (reads.shift() ?? assert.fail("no read"))([]);
  await settled();
  assert.equal(logged.length, 1, "the first read acted");
  assert.equal(reads.length, 1, "and the change told as it acted is read again");
  (reads.shift() ?? assert.fail("no read"))([]);
  await settled();
  assert.deepEqual([logged.length, reads.length], [2, 0], "then nothing more");
});

test("a read that fails is warned of once, however many changes and ticks wait for it; a tick waits for a stalled read only once", async () => {
  const { watch, reads, warnings } = heldWatch();
  for (let change = 0; change < 20; change++) watch.changed(MANAGER);
  await watch.tick();
  await watch.tick();
  assert.equal(reads.length, 1, "one read for all of them");
  const started = Date.now();
  await watch.tick();
  assert.ok(Date.now() - started < 40, "a tick after one that waited in vain doesn't wait for the same read");
  (reads.shift() ?? assert.fail("no read"))(new Error("bb is down"));
  await settled();
  assert.deepEqual(warnings, ["Could not read what 6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10's issues say now; the next change or tick tries again: bb is down"]);

  const next = watch.tick();
  await settled();
  assert.equal(reads.length, 1, "the next tick reads again");
  (reads.shift() ?? assert.fail("no read"))([]);
  await next;
});

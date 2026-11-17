// One thing at a time per issue (issue-turns.ts), across the tools, the tick and bb: each case holds
// one operation in bb, or leaves a thread running that the plugin no longer counts on, and checks
// that nothing the plugin starts or wakes on the issue runs beside another thread of it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../model/agent.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { bbHttpError, coordinating, HEAD, isRefusal, settled, startedAgent, textOf, threadIn } from "../test-harness.ts";

const a1 = agentIdSchema.parse("a1");
const i1 = issueIdSchema.parse("i1");
const DONE = { status: "done", summary: "Retries land with backoff", did: ["Added exponential backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [], headSha: HEAD };
const FAILS = { criteria: [{ criterion: 1, result: "fail", evidence: "$ npm test\nnot ok 13" }], findings: [] };

/** A promise bb's fake waits on, and the function that lets it go. */
function hold(): { done: Promise<void>; release: () => void } {
  let release = (): void => assert.fail("never held");
  const done = new Promise<void>((resolve) => (release = resolve));
  return { done, release };
}

/** A regional manager whose agent a1 holds i1, every thread idle; a tool call waits `turnWaitMs` for i1's turn. */
async function onI1(turnWaitMs?: number) {
  const { kit, threadId, coordinatorId } = await coordinating(turnWaitMs === undefined ? {} : { turnWaitMs });
  const { agentThreadId } = await startedAgent(kit, threadId);
  kit.thread(threadId).status = "idle";
  kit.thread(agentThreadId).status = "idle";
  const start = async () => kit.call("agent_start", { issue: "i1" }, threadId);
  /** Every verifier bb spawned for a1, oldest first. */
  const verifiers = () => [...Array(kit.spawned()).keys()].map((i) => kit.thread(`thr_${i + 1}`)).filter((thread) => thread.spawnedWith.parentThreadId === agentThreadId);
  const check = () => kit.store.latestHandoff(coordinatorId, a1)?.check ?? assert.fail("no check");
  return { kit, threadId, coordinatorId, agentThreadId, start, verifiers, check };
}

test("a newer done handoff asked while the first's verifier starts waits for i1, then stops that verifier before starting its own; the handover leaves none running", async () => {
  const { kit, coordinatorId, agentThreadId, start, verifiers } = await onI1();
  kit.providers.holding = true;
  const first = kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  assert.ok(kit.providers.held.length > 0, "the first verifier's start reads the catalog");
  const second = kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  assert.equal(kit.store.record(coordinatorId, i1).length, 1, "the second waits for i1, storing nothing yet");
  kit.providers.holding = false;
  kit.providers.held.splice(0).forEach((release) => release());
  await Promise.all([first, second]);

  assert.deepEqual(verifiers().map(({ status }) => status), ["idle", "active"], "the first verifier stopped before the second started");
  await kit.idle(agentThreadId, "Handed off.");
  const next = threadIn(textOf(await start()));
  assert.deepEqual([...verifiers().map(({ status }) => status), kit.thread(next).status], ["idle", "idle", "active"], "only a2 runs");
});

test("a superseded verifier bb won't stop keeps the next verifier from starting and refuses the handover, naming it; once bb stops it, both go ahead", async () => {
  const { kit, agentThreadId, start, verifiers, check } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  const [old = assert.fail("no verifier")] = verifiers();
  kit.stopRequests.byThread.set(old.id, bbHttpError(500, "internal", "Stop failed"));
  kit.startTurn(agentThreadId); // the user asks a1 for one more change
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");

  assert.deepEqual([verifiers().length, check().verdict.state], [1, "queued"], "no second verifier beside the one bb didn't stop");
  const refused = await start();
  assert.ok(isRefusal(refused));
  assert.equal(textOf(refused), `agent_start is refused: the verifier @thread:${old.id} wasn't stopped: bb answered HTTP 500: Stop failed, so no agent started and a1 still holds i1. Call agent_start again once it has stopped.`);

  kit.stopRequests.byThread.delete(old.id);
  await kit.tick();
  assert.deepEqual([old.status, verifiers().length, check().verdict.state], ["idle", 2, "running"], "the tick stops it, then starts the queued check's verifier");
  await kit.call("issue_verdict", { criteria: [{ criterion: 1, result: "pass", evidence: "$ npm test\nok" }], findings: [] }, verifiers()[1]?.id ?? assert.fail());
  await kit.idle(verifiers()[1]?.id ?? assert.fail(), "Done.");
  assert.match(textOf(await start()), /^Stopped a1 and started a2/);
});

test("findings on their way hold i1: a handover that waited past the bound is refused, changing nothing, and runs once they are through", async () => {
  const { kit, agentThreadId, start, verifiers, check } = await onI1(20);
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const sends = hold();
  kit.sends.pending = sends.done;
  const returning = kit.call("issue_verdict", FAILS, verifiers()[0]?.id ?? assert.fail());
  await settled();

  const refused = await start();
  assert.equal(textOf(refused), "agent_start is refused: an earlier operation on i1 hasn't finished yet, so nothing changed. Call agent_start again in a minute.");
  assert.deepEqual([kit.store.agent(check().coordinatorId, a1)?.ended, kit.thread(agentThreadId).status], [null, "idle"], "nothing stopped, nothing replaced");
  kit.sends.pending = null;
  sends.release();
  await returning;
  assert.equal(kit.thread(agentThreadId).status, "active", "the findings started a1's fix turn");

  const next = threadIn(textOf(await start()));
  assert.deepEqual([kit.thread(agentThreadId).status, kit.thread(next).status], ["idle", "active"], "a1's fix turn stopped before a2 started");
});

test("a message bb queued for a1 is taken back before the handover stops it, and the handover quotes it as never received", async () => {
  const { kit, threadId, agentThreadId, start } = await onI1();
  kit.thread(agentThreadId).hasPendingInteraction = true; // a1 waits on the user's approval
  assert.match(textOf(await kit.call("agent_message", { agent: "a1", text: "Also cap the backoff at 60s." }, threadId)), /^Queued for a1/);
  assert.equal(kit.queued(agentThreadId).length, 1);

  const result = textOf(await start());
  assert.match(result, /^Stopped a1 and started a2/);
  assert.ok(result.endsWith("Your message to a1 still waited in bb's queue, so it was taken back before a1 stopped, and a1 never got it:\n\n```\nAlso cap the backoff at 60s.\n```"), result);
  assert.deepEqual([kit.queued(agentThreadId), kit.delivered(agentThreadId).includes("Also cap the backoff at 60s.")], [[], false]);
});

test("a queued message the handover can't take back, a failed delete or one the user queued, refuses it, naming the message; nothing is stopped", async () => {
  const { kit, threadId, agentThreadId, start } = await onI1();
  kit.thread(agentThreadId).hasPendingInteraction = true;
  await kit.call("agent_message", { agent: "a1", text: "Also cap the backoff at 60s." }, threadId);
  kit.startTurn(agentThreadId);
  kit.queueDeletes.failure = new Error("fetch failed");

  const refused = await start();
  assert.equal(textOf(refused), "agent_start is refused: bb still has your message queued for a1, which would wake it once stopped, and couldn't take it back, so no agent started and a1 still holds i1. Call agent_start again once bb has sent or deleted it.");
  assert.deepEqual([kit.queued(agentThreadId).length, kit.thread(agentThreadId).status, kit.spawned()], [1, "active", 2], "the message waits, a1 runs on, and nothing started");

  kit.queueDeletes.failure = null;
  await kit.dispatch(kit.queued(agentThreadId)[0] ?? assert.fail());
  // The user queues one of their own; the plugin never takes back what it didn't queue.
  kit.userQueues(agentThreadId, "Wait, use jitter too.");
  assert.match(textOf(await start()), /^agent_start is refused: bb still has a message from the user queued for a1/);
});

test("the tick's follow decides on what bb says once it holds i1: a reminder still on its way keeps the next tick off i1, and the verifier it woke is not given up on", async () => {
  const { kit, agentThreadId, verifiers, check } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const verifier = verifiers()[0]?.id ?? assert.fail();
  await kit.idle(verifier, "All pass.");
  const sends = hold();
  kit.sends.pending = sends.done;
  await kit.tick();
  const { verdict } = check();
  assert.equal(verdict.state === "running" && verdict.nudged, true, "the reminder is on its way");
  await kit.tick();
  kit.sends.pending = null;
  sends.release();
  await settled();
  assert.equal(kit.thread(verifier).status, "active", "the reminder woke the verifier");

  await kit.tick();
  assert.equal(check().verdict.state, "running", "a verifier at work is never given up on");
});

test("a tick skips an issue whose turn is held, and still serves another issue and the inbox's pass", async () => {
  const { kit, threadId, coordinatorId, agentThreadId } = await onI1();
  const other = (await startedAgent(kit, threadId, { title: "Dead letters" })).agentThreadId;
  kit.thread(other).status = "idle";
  kit.thread(threadId).status = "idle";
  await kit.call("crew_remind", { note: "check on i2", at: "1m" }, threadId);
  const stops = hold();
  kit.stopRequests.pending = stops.done;
  kit.startTurn(agentThreadId);
  const stopping = kit.call("agent_stop", { agent: "a1" }, threadId); // holds i1 while bb stops a1
  await settled();
  // The user archives both agents' threads: the tick ends each agent, in its issue's turn.
  kit.thread(agentThreadId).archivedAt = 5_000;
  kit.thread(other).archivedAt = 5_000;

  kit.clock.now = Date.now() + 2 * 60_000;
  const ticked = kit.tick().then(() => "done");
  assert.equal(await Promise.race([ticked, new Promise((resolve) => setTimeout(() => resolve("waiting"), 200))]), "done", "the tick never waits for i1");
  assert.deepEqual(kit.store.agents(coordinatorId).map((agent) => agent.ended?.how ?? null), [null, "archived"], "i1 skipped, i2's agent ended");
  assert.deepEqual(kit.store.reminders(coordinatorId), [], "the inbox's pass fired the reminder");

  kit.stopRequests.pending = null;
  stops.release();
  await stopping;
});

test("agent_stop holds i1 until bb answers its reads: a message asked meanwhile is refused after waiting, and never reaches a1", async () => {
  const { kit, threadId, agentThreadId, coordinatorId, start } = await onI1(20);
  kit.startTurn(agentThreadId);
  const reads = hold();
  kit.turnEvents.pending = reads.done;
  const stopping = kit.call("agent_stop", { agent: "a1" }, threadId);
  await settled();

  const refused = await kit.call("agent_message", { agent: "a1", text: "One more change." }, threadId);
  assert.equal(textOf(refused), "agent_message is refused: an earlier operation on i1 hasn't finished yet, so nothing changed. Call agent_message again in a minute.");
  kit.turnEvents.pending = null;
  reads.release();
  assert.match(textOf(await stopping), /^a1 is stopped/);
  assert.deepEqual([kit.store.agent(coordinatorId, a1)?.ended?.how, kit.thread(agentThreadId).status, kit.delivered(agentThreadId).includes("One more change.")], ["stopped", "idle", false]);
  assert.match(textOf(await kit.call("agent_message", { agent: "a1", text: "One more change." }, threadId)), /a1 was stopped, so it takes no more messages/);

  const next = threadIn(textOf(await start()));
  assert.deepEqual([kit.thread(agentThreadId).status, kit.thread(next).status], ["idle", "active"]);
});

test("a stopped agent's verifier is stopped by the next start, and its check superseded, so the tick never wakes it beside the new agent", async () => {
  const { kit, threadId, agentThreadId, start, verifiers, check } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const verifier = verifiers()[0]?.id ?? assert.fail();
  await kit.call("agent_stop", { agent: "a1" }, threadId);
  assert.equal(kit.thread(verifier).status, "active", "agent_stop leaves its verifier checking");

  const next = threadIn(textOf(await start()));
  assert.deepEqual([kit.thread(verifier).status, check().verdict.state], ["idle", "superseded"]);
  await kit.tick();
  await kit.tick();
  assert.deepEqual([kit.delivered(verifier), kit.thread(verifier).status, kit.thread(next).status], [[], "idle", "active"], "no reminder woke it");
});

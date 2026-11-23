// One thing at a time per issue (issue-turns.ts), across the tools, the tick and bb: each case holds
// one operation in bb, or leaves a thread running that the plugin no longer counts on, and checks
// that nothing the plugin starts or wakes on the issue runs beside another thread of it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { bbHttpError, coordinating, HEAD, isRefusal, settled, startedAgent, textOf, threadIn } from "../test-harness.ts";

const a1 = agentIdSchema.parse("a1");
const i1 = issueIdSchema.parse("WEB-1");
const DONE = { status: "done", summary: "Retries land with backoff", did: ["Added exponential backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [], headSha: HEAD };
const FAILS = { criteria: [{ criterion: 1, result: "fail", evidence: "$ npm test\nnot ok 13" }], findings: [] };
const PASSES = { criteria: [{ criterion: 1, result: "pass", evidence: "$ npm test\nok" }], findings: [] };

/** A promise bb's fake waits on, and the function that lets it go. */
function hold(): { done: Promise<void>; release: () => void } {
  let release = (): void => assert.fail("never held");
  const done = new Promise<void>((resolve) => (release = resolve));
  return { done, release };
}

/** A regional manager whose agent a1 holds WEB-1, every thread idle; a tool call waits `turnWaitMs` for WEB-1's turn. */
async function onI1(turnWaitMs?: number) {
  const { kit, threadId, coordinatorId } = await coordinating(turnWaitMs === undefined ? {} : { turnWaitMs });
  const { agentThreadId } = await startedAgent(kit, threadId);
  kit.thread(threadId).status = "idle";
  kit.thread(agentThreadId).status = "idle";
  const start = async () => kit.call("agent_start", { issue: "WEB-1" }, threadId);
  /** Every thread bb spawned for a1's checks in one of `kinds`, oldest first. */
  const childrenOf = (...kinds: string[]) =>
    [...Array(kit.spawned()).keys()].map((i) => kit.thread(`thr_${i + 1}`)).filter((thread) => thread.spawnedWith.parentThreadId === agentThreadId && kinds.includes(kit.store.roleOfThread(thread.id)?.kind ?? ""));
  /** Every verifier bb spawned for a1, oldest first; its reviewers, a1's children too, left out. */
  const verifiers = () => childrenOf("verifier");
  /** Every reviewer and verifier bb spawned for a1, oldest first. */
  const checkers = () => childrenOf("reviewer", "verifier");
  const check = () => kit.store.latestHandoff(coordinatorId, a1)?.check ?? assert.fail("no check");
  return { kit, threadId, coordinatorId, agentThreadId, start, verifiers, checkers, check };
}

test("a newer done handoff asked while the first's reviewer starts waits for WEB-1, then stops that reviewer before starting its own; the handover leaves none running", async () => {
  const { kit, coordinatorId, agentThreadId, start, checkers } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  kit.providers.holding = true;
  await kit.idle(agentThreadId, "Handed off.");
  assert.ok(kit.providers.held.length > 0, "the first reviewer's start reads the catalog");
  await kit.startTurn(agentThreadId); // the user asks a1 for one more change
  const second = kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  assert.equal(kit.store.record(coordinatorId, i1).length, 1, "the second waits for WEB-1, storing nothing yet");
  kit.providers.holding = false;
  kit.providers.held.splice(0).forEach((release) => release());
  await second;
  await kit.idle(agentThreadId, "Handed off.");

  assert.deepEqual(
    checkers().map((thread) => [kit.store.roleOfThread(thread.id)?.kind, thread.status]),
    [
      ["reviewer", "idle"],
      ["reviewer", "idle"],
      ["verifier", "active"],
    ],
    "the first reviewer stopped before the second started, and that one before its verifier",
  );
  const next = threadIn(textOf(await start()));
  assert.deepEqual([...checkers().map(({ status }) => status), kit.thread(next).status], ["idle", "idle", "idle", "active"], "only a2 runs");
});

test("a superseded verifier bb won't stop keeps the next verifier from starting and refuses the handover, naming it; once bb stops it, both go ahead", async () => {
  const { kit, agentThreadId, start, verifiers, check } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const [old = assert.fail("no verifier")] = verifiers();
  kit.stopRequests.byThread.set(old.id, bbHttpError(500, "internal", "Stop failed"));
  await kit.startTurn(agentThreadId); // the user asks a1 for one more change
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");

  assert.deepEqual([verifiers().length, check().verdict.state], [1, "queued"], "no second verifier beside the one bb didn't stop");
  const refused = await start();
  assert.ok(isRefusal(refused));
  assert.equal(textOf(refused), `agent_start is refused: the verifier @thread:${old.id} couldn't be confirmed stopped: bb answered HTTP 500: Stop failed, so no agent started and a1 still holds WEB-1. Call agent_start again once it has stopped.`);

  kit.stopRequests.byThread.delete(old.id);
  await kit.tick();
  assert.deepEqual([old.status, verifiers().length, check().verdict.state], ["idle", 2, "running"], "the tick stops it, then starts the queued check's verifier");
  await kit.call("issue_verdict", { criteria: [{ criterion: 1, result: "pass", evidence: "$ npm test\nok" }], findings: [] }, verifiers()[1]?.id ?? assert.fail());
  await kit.idle(verifiers()[1]?.id ?? assert.fail(), "Done.");
  assert.match(textOf(await start()), /^Stopped a1 and started a2/);
});

test("findings on their way hold WEB-1: a handover that waited past the bound is refused, changing nothing, and runs once they are through", async () => {
  const { kit, agentThreadId, start, verifiers, check } = await onI1(20);
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const sends = hold();
  kit.sends.pending = sends.done;
  const verifier = verifiers()[0]?.id ?? assert.fail();
  await kit.call("issue_verdict", FAILS, verifier);
  await kit.idle(verifier, "Verdict returned.");

  const refused = await start();
  assert.equal(textOf(refused), "agent_start is refused: an earlier operation on WEB-1 hasn't finished yet, so nothing changed. Call agent_start again in a minute.");
  assert.deepEqual([kit.store.agent(check().coordinatorId, a1)?.ended, kit.thread(agentThreadId).status], [null, "idle"], "nothing stopped, nothing replaced");
  kit.sends.pending = null;
  sends.release();
  await settled();
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
  assert.ok(result.endsWith("Your message to a1 still waited in bb's queue, so it was taken back before anything started, and a1 never got it:\n\n```\nYour regional manager's next instruction, on WEB-1:\n\nAlso cap the backoff at 60s.\n```"), result);
  assert.deepEqual([kit.queued(agentThreadId), kit.delivered(agentThreadId).includes("Your regional manager's next instruction, on WEB-1:\n\nAlso cap the backoff at 60s.")], [[], false]);
});

test("a queued message the handover can't take back, a failed delete or one the user queued, refuses it, naming the message; nothing is stopped", async () => {
  const { kit, threadId, agentThreadId, start } = await onI1();
  kit.thread(agentThreadId).hasPendingInteraction = true;
  await kit.call("agent_message", { agent: "a1", text: "Also cap the backoff at 60s." }, threadId);
  await kit.startTurn(agentThreadId);
  kit.queueDeletes.failure = new Error("fetch failed");

  const refused = await start();
  assert.equal(textOf(refused), "agent_start is refused: bb still has your message queued for a1 and couldn't take it back; once sent, it would wake a1 beside a new agent, so no agent started and a1 still holds WEB-1. Call agent_start again once bb has sent or deleted it.");
  assert.deepEqual([kit.queued(agentThreadId).length, kit.thread(agentThreadId).status, kit.spawned()], [1, "active", 2], "the message waits, a1 runs on, and nothing started");

  kit.queueDeletes.failure = null;
  await kit.dispatch(kit.queued(agentThreadId)[0] ?? assert.fail());
  // The user queues one of their own; the plugin never takes back what it didn't queue.
  kit.userQueues(agentThreadId, "Wait, use jitter too.");
  assert.match(textOf(await start()), /^agent_start is refused: bb still has a message from the user queued for a1/);
});

test("the follow decides on what bb says once it holds WEB-1: a reminder still on its way keeps the tick off WEB-1, and the verifier it woke is not given up on", async () => {
  const { kit, agentThreadId, verifiers, check } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const verifier = verifiers()[0]?.id ?? assert.fail();
  const sends = hold();
  kit.sends.pending = sends.done;
  await kit.idle(verifier, "All pass."); // the plugin hears it idle; its reminder waits at bb
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
  await kit.call("crew_remind", { note: "check on WEB-2", at: "1m" }, threadId);
  const stops = hold();
  kit.stopRequests.pending = stops.done;
  await kit.startTurn(agentThreadId);
  const stopping = kit.call("agent_stop", { agent: "a1" }, threadId); // holds WEB-1 while bb stops a1
  await settled();
  // The user archives both agents' threads: the tick ends each agent, in its issue's turn.
  kit.thread(agentThreadId).archivedAt = 5_000;
  kit.thread(other).archivedAt = 5_000;

  kit.clock.now = Date.now() + 2 * 60_000;
  const ticked = kit.tick().then(() => "done");
  assert.equal(await Promise.race([ticked, new Promise((resolve) => setTimeout(() => resolve("waiting"), 200))]), "done", "the tick never waits for WEB-1");
  assert.deepEqual(kit.store.agents(coordinatorId).map((agent) => agent.ended?.how ?? null), [null, "archived"], "WEB-1 skipped, WEB-2's agent ended");
  assert.deepEqual(kit.store.reminders(coordinatorId), [], "the inbox's pass fired the reminder");

  kit.stopRequests.pending = null;
  stops.release();
  await stopping;
});

test("agent_stop holds WEB-1 until bb answers its reads: a message asked meanwhile is refused after waiting, and never reaches a1", async () => {
  const { kit, threadId, agentThreadId, coordinatorId, start } = await onI1(20);
  await kit.startTurn(agentThreadId);
  const reads = hold();
  kit.turnEvents.pending = reads.done;
  const stopping = kit.call("agent_stop", { agent: "a1" }, threadId);
  await settled();

  const refused = await kit.call("agent_message", { agent: "a1", text: "One more change." }, threadId);
  assert.equal(textOf(refused), "agent_message is refused: an earlier operation on WEB-1 hasn't finished yet, so nothing changed. Call agent_message again in a minute.");
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

test("a start after agent_stop takes back your message bb still queued for the stopped a1, so it never wakes a1 beside a2, and quotes it as a1's", async () => {
  const { kit, threadId, agentThreadId, start } = await onI1();
  kit.thread(agentThreadId).hasPendingInteraction = true; // a1 waits on the user's approval
  await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId);
  assert.equal(kit.queued(agentThreadId).length, 1);
  await kit.call("agent_stop", { agent: "a1" }, threadId);

  const result = textOf(await start());
  assert.match(result, /^Started a2 on WEB-1/);
  assert.ok(result.endsWith("Your message to a1 still waited in bb's queue, so it was taken back before anything started, and a1 never got it:\n\n```\nYour regional manager's next instruction, on WEB-1:\n\nPlease add jitter.\n```"), result);
  assert.deepEqual([kit.queued(agentThreadId), kit.delivered(agentThreadId).includes("Your regional manager's next instruction, on WEB-1:\n\nPlease add jitter.")], [[], false]);
});

test("a start after agent_stop takes back the findings bb still queued for the stopped a1, so they never wake it beside a2", async () => {
  const { kit, threadId, agentThreadId, start, verifiers } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const verifier = verifiers()[0]?.id ?? assert.fail();
  await kit.call("issue_verdict", FAILS, verifier);
  kit.thread(agentThreadId).status = "starting"; // a turn someone started in a1's thread, which bb lists no event of yet
  await kit.idle(verifier, "Verdict returned.");
  assert.equal(kit.queued(agentThreadId).length, 1, "the findings wait in a1's queue");
  await kit.call("agent_stop", { agent: "a1" }, threadId);

  const next = threadIn(textOf(await start()));
  assert.deepEqual([kit.queued(agentThreadId), kit.thread(agentThreadId).status, kit.thread(next).status], [[], "idle", "active"]);
});

test("a start refuses on what bb still has queued for an earlier, ended agent and couldn't take back, naming that agent; nothing is stopped or started", async () => {
  const { kit, threadId, agentThreadId, start } = await onI1();
  await kit.call("agent_stop", { agent: "a1" }, threadId);
  kit.userQueues(agentThreadId, "Wait, use jitter too.");
  const spawned = kit.spawned();

  assert.equal(
    textOf(await start()),
    "agent_start is refused: bb still has a message from the user queued for a1 and couldn't take it back; once sent, it would wake a1 beside a new agent, so no agent started. Call agent_start again once bb has sent or deleted it.",
  );
  assert.equal(kit.spawned(), spawned);
});

test("an agent end the tick started and didn't wait for writes nothing once the plugin is disposed while it reads bb; the reloaded plugin ends the agent", async () => {
  const { kit, coordinatorId, agentThreadId } = await onI1();
  const read = hold();
  kit.turnEvents.pending = read.done;
  kit.thread(agentThreadId).archivedAt = 5_000;
  await kit.tick();
  assert.equal(kit.store.agent(coordinatorId, a1)?.ended, null, "the end waits on bb's read of a1's turns");

  kit.dispose();
  kit.turnEvents.pending = null;
  read.release();
  await settled();
  assert.equal(kit.store.agent(coordinatorId, a1)?.ended, null);
  assert.match(kit.warnings().at(-1) ?? "", /^Could not end a1, whose thread was archived; the next tick tries again: Regional Manager was reloaded or disabled/);

  kit.reload();
  await kit.tick();
  assert.equal(kit.store.agent(coordinatorId, a1)?.ended?.how, "archived");
});

test("findings on their way when the plugin is disposed settle nothing once bb answers, which leaves the verdict to the reloaded plugin", async () => {
  const { kit, coordinatorId, agentThreadId, verifiers, check } = await onI1();
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const sends = hold();
  kit.sends.pending = sends.done;
  const verifier = verifiers()[0]?.id ?? assert.fail();
  await kit.call("issue_verdict", FAILS, verifier);
  await kit.idle(verifier, "Verdict returned.");
  const sending = check().verdict;
  assert.equal(sending.state === "returned" && sending.settlement.kind, "sending-back");

  kit.dispose();
  kit.sends.pending = null;
  sends.release();
  await settled();
  const after = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
  assert.equal(after?.state === "returned" && after.settlement.kind, "sending-back", "nothing settled it after disposal");
  assert.match(kit.warnings().at(-1) ?? "", /^Could not look at the checks of WEB-1 again; the next tick tries again: Regional Manager was reloaded or disabled/);

  kit.reload();
  await kit.tick();
  const reloaded = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
  assert.equal(reloaded?.state === "returned" && reloaded.settlement.kind, "maybe-sent-back");
});

// An agent and its own verifier share its environment, and the plugin never runs them together:
// a verifier starts or is reminded only while bb reports its agent idle, findings go back only once
// bb reports the verifier no longer running, and a manager's message stops a running check first.

/** The statuses of a1's thread and of a verifier's, in that order. */
const statusesOf = (kit: Awaited<ReturnType<typeof onI1>>["kit"], agentThreadId: string, verifier: string) => [kit.thread(agentThreadId).status, kit.thread(verifier).status];

/** a1 hands off as done from a turn of its own, as an agent does, and that turn ends; returns its verifier, running. */
async function handedOff({ kit, agentThreadId, verifiers }: Awaited<ReturnType<typeof onI1>>): Promise<string> {
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  return verifiers().at(-1)?.id ?? assert.fail("no verifier");
}

test("B3: a done handoff queues its check while a1's turn runs; its verifier starts only once bb reports a1 idle", async () => {
  const { kit, agentThreadId, verifiers, check } = await onI1();
  await kit.startTurn(agentThreadId);
  assert.match(textOf(await kit.call("agent_handoff", DONE, agentThreadId)), /^Handed off\. Once this turn of yours ends, a verifier checks your commit/);
  await kit.tick();
  assert.deepEqual([verifiers().length, check().verdict.state], [0, "queued"], "no verifier beside the turn that handed off, from the tool or the tick");

  await kit.idle(agentThreadId, "Handed off.");
  const [verifier = assert.fail("no verifier")] = verifiers();
  assert.deepEqual([check().verdict.state, ...statusesOf(kit, agentThreadId, verifier.id)], ["running", "idle", "active"]);
});

test("a check whose agent's idle event was missed, as across a reload, is started by the tick once bb reports a1 idle", async () => {
  const { kit, agentThreadId, verifiers, check } = await onI1();
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  kit.reload();
  kit.thread(agentThreadId).status = "idle"; // its turn ended while no plugin heard it
  assert.deepEqual([check().verdict.state, verifiers().length], ["queued", 0]);
  await kit.tick();
  await settled();
  assert.deepEqual([check().verdict.state, verifiers().length], ["running", 1]);
});

test("a1 woken by a person while its check is queued: the verifier waits for that turn too, then checks, and its failed verdict goes to the manager, not back to a1", async () => {
  const { kit, coordinatorId, agentThreadId, verifiers, check } = await onI1();
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.startTurn(agentThreadId); // the user asks a1 for one more thing before the plugin hears it idle
  await kit.tick();
  assert.deepEqual([verifiers().length, check().verdict.state], [0, "queued"], "no verifier while the user's turn runs");

  await kit.idle(agentThreadId, "Done that too.");
  const [verifier = assert.fail("no verifier")] = verifiers();
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier.id), ["idle", "active"]);
  await kit.call("issue_verdict", FAILS, verifier.id);
  await kit.idle(verifier.id, "Verdict returned.");
  assert.deepEqual(kit.sent().filter((args) => args.threadId === agentThreadId), [], "a turn followed the handoff, so its findings are the manager's");
  const { verdict } = check();
  assert.deepEqual([verdict.state === "returned" && verdict.settlement.kind, kit.store.agent(coordinatorId, a1)?.fixRounds], ["checked", 0]);
});

test("B2: a failed verdict is stored at once, but its findings wait for the verifier's turn to end, then wake a1", async () => {
  const on = await onI1();
  const { kit, coordinatorId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  assert.match(textOf(await kit.call("issue_verdict", FAILS, verifier)), /^Verdict recorded/);
  const owed = check().verdict;
  assert.equal(owed.state === "returned" && owed.settlement.kind, "pending", "owed: stored, not yet sent");
  assert.deepEqual([kit.sent().filter((args) => args.threadId === agentThreadId), ...statusesOf(kit, agentThreadId, verifier)], [[], "idle", "active"], "a1 not woken beside its verifier");

  await kit.idle(verifier, "Verdict returned.");
  assert.match(kit.delivered(agentThreadId).at(-1) ?? "", /^## Verifier findings/);
  assert.deepEqual([...statusesOf(kit, agentThreadId, verifier), kit.store.agent(coordinatorId, a1)?.fixRounds], ["active", "idle", 1]);
});

test("findings owed across a reload are sent by the tick once bb reports the verifier idle, once", async () => {
  const on = await onI1();
  const { kit, coordinatorId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  await kit.call("issue_verdict", FAILS, verifier);
  const owed = check().verdict;
  assert.deepEqual([owed.state === "returned" && owed.settlement.kind, kit.delivered(agentThreadId)], ["pending", []], "owed as the plugin reloads");
  kit.reload();
  kit.thread(verifier).status = "idle"; // its turn ended while no plugin heard it
  await kit.tick();
  await settled();
  await kit.tick();
  await settled();
  assert.equal(kit.delivered(agentThreadId).filter((text) => text.startsWith("## Verifier findings")).length, 1);
  const sent = check().verdict;
  assert.deepEqual([sent.state === "returned" && sent.settlement.kind, kit.store.agent(coordinatorId, a1)?.fixRounds], ["sent-back", 1]);
});

test("a verifier still running on the tick after its verdict is stopped first, then its findings go; one bb doesn't confirm stopped keeps them owed, Verifying, and the tick tries again", async () => {
  const on = await onI1();
  const { kit, coordinatorId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  await kit.call("issue_verdict", FAILS, verifier); // and its turn runs on, never ending
  kit.stopRequests.byThread.set(verifier, "stopping");
  await kit.tick();
  await settled();
  const owed = check().verdict;
  assert.deepEqual([owed.state === "returned" && owed.settlement.kind, ...statusesOf(kit, agentThreadId, verifier)], ["pending", "idle", "stopping"], "nothing sent beside it");
  assert.match(kit.warnings().at(-1) ?? "", new RegExp(`^On WEB-1: the verifier @thread:${verifier} is still stopping, so its findings wait; the next tick tries again\\.`));
  const board = await kit.rpc.board({ coordinatorId });
  assert.equal(board.issues[0]?.headline, "Verifying: Retries land with backoff");
  assert.deepEqual(kit.store.unannounced(coordinatorId), [], "the manager hears nothing yet");

  kit.stopRequests.byThread.delete(verifier);
  kit.thread(verifier).status = "active";
  await kit.tick();
  await settled();
  assert.deepEqual([...statusesOf(kit, agentThreadId, verifier), kit.delivered(agentThreadId).filter((text) => text.startsWith("## Verifier findings")).length], ["active", "idle", 1]);
});

test("B1: agent_message to a1 while its verifier checks stops the verifier first, drops the check, then sends; the next done handoff is checked afresh", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId, verifiers, check } = on;
  const verifier = await handedOff(on);
  const dropped = check().id;
  const result = textOf(await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId));
  assert.equal(result, "Sent to a1. The check of a1's last done handoff was dropped before its verdict, as you asked for more work: nothing reports on that handoff, and a1's next done handoff is checked afresh.");
  assert.deepEqual([...statusesOf(kit, agentThreadId, verifier), kit.store.check(dropped)?.verdict.state], ["active", "idle", "superseded"]);
  assert.equal(kit.delivered(agentThreadId).at(-1), "Your regional manager's next instruction, on WEB-1:\n\nPlease add jitter.", "marked as the manager's next instruction");
  await kit.tick();
  assert.deepEqual(kit.delivered(verifier), [], "no reminder to the dropped check's verifier");

  await kit.idle(agentThreadId, "Added jitter.");
  const next = await handedOff(on);
  assert.deepEqual([verifiers().length, check().verdict.state, ...statusesOf(kit, agentThreadId, next)], [2, "running", "idle", "active"]);
});

test("agent_message to a1 while its done handoff's check is still queued drops the check as it steers a1's turn", async () => {
  const { kit, threadId, agentThreadId, verifiers, check } = await onI1();
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  assert.match(textOf(await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId)), /^Sent to a1\. The check of a1's last done handoff was dropped/);
  await kit.idle(agentThreadId, "Added jitter.");
  assert.deepEqual([check().verdict.state, verifiers().length], ["superseded", 0], "no verifier for the dropped check");
});

test("agent_message to a1 whose verifier bb doesn't confirm stopped is refused and sends nothing; once it stops, the message goes", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  kit.stopRequests.byThread.set(verifier, bbHttpError(500, "internal", "Stop failed"));
  const refused = await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId);
  assert.ok(isRefusal(refused));
  assert.equal(
    textOf(refused),
    `agent_message is refused and nothing was sent: the verifier @thread:${verifier} couldn't be confirmed stopped: bb answered HTTP 500: Stop failed, and a1 never runs beside another thread of WEB-1. Call agent_message again once it has stopped.`,
  );
  assert.deepEqual([kit.sendAttempts().includes(agentThreadId), check().verdict.state, ...statusesOf(kit, agentThreadId, verifier)], [false, "running", "idle", "active"]);

  kit.stopRequests.byThread.delete(verifier);
  assert.match(textOf(await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId)), /^Sent to a1\. The check/);
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["active", "idle"]);
});

test("agent_message while a1's findings are owed stops the verifier and sends; the verdict then goes to the manager, not back to a1", async () => {
  const on = await onI1();
  const { kit, threadId, coordinatorId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  await kit.call("issue_verdict", FAILS, verifier);
  assert.equal(textOf(await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId)), "Sent to a1.");
  await settled();
  const { verdict } = check();
  assert.deepEqual([verdict.state === "returned" && verdict.settlement.kind, kit.store.agent(coordinatorId, a1)?.fixRounds], ["checked", 0]);
  assert.deepEqual(kit.delivered(agentThreadId), ["Your regional manager's next instruction, on WEB-1:\n\nPlease add jitter."], "no findings sent after the manager's message");
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["active", "idle"]);
});

test("B7: a quiet verifier isn't reminded while a person has woken a1; the reminder comes once a1 is idle again", async () => {
  const on = await onI1();
  const { kit, agentThreadId } = on;
  const verifier = await handedOff(on);
  await kit.startTurn(agentThreadId); // the user asks a1 something while its verifier checks
  await kit.idle(verifier, "Forgot to return the verdict.");
  await kit.tick();
  assert.deepEqual([kit.delivered(verifier), ...statusesOf(kit, agentThreadId, verifier)], [[], "active", "idle"], "no reminder beside a1");

  await kit.idle(agentThreadId, "Answered.");
  assert.match(kit.delivered(verifier).join(), /without calling issue_verdict/);
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["idle", "active"]);
});

// Where the environment changes hands, the side giving it up is stopped whatever bb reports: a
// thread bb reports idle can still hold a background command, whose finish starts a new turn there
// by itself unless a stop ended it (kit.leavesBackground, kit.backgroundFinishes).

test("a1 idle with a background command after its done handoff is stopped before its verifier starts, so it never wakes beside it; its handoff stands, WEB-1 stays Verifying, and the manager hears nothing", async () => {
  const { kit, coordinatorId, agentThreadId, verifiers, check } = await onI1();
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  kit.leavesBackground(agentThreadId); // its turn ended with a background sleep still running: bb reports it idle
  await kit.idle(agentThreadId, "Handed off.");
  const [verifier = assert.fail("no verifier")] = verifiers();
  const turns = kit.thread(agentThreadId).turns.length;
  await kit.backgroundFinishes(agentThreadId);
  assert.deepEqual([kit.thread(agentThreadId).turns.length, ...statusesOf(kit, agentThreadId, verifier.id)], [turns, "idle", "active"], "a1 never woke beside its verifier");

  await kit.idle(agentThreadId, "Handed off."); // were bb to announce the stop of an idle thread
  assert.deepEqual([check().verdict.state, kit.store.agent(coordinatorId, a1)?.ended], ["running", null], "a1 still holds WEB-1, its done handoff checked");
  const board = await kit.rpc.board({ coordinatorId });
  assert.equal(board.issues[0]?.headline, "Verifying: Retries land with backoff");
  assert.deepEqual(kit.store.unannounced(coordinatorId), [], "the manager hears nothing: neither a stop nor a turn ended without a handoff");
});

test("a1 that bb doesn't confirm stopped after its done handoff keeps its check queued and the manager unaware; the tick starts the verifier once bb stops it", async () => {
  const { kit, coordinatorId, agentThreadId, verifiers, check } = await onI1();
  kit.stopRequests.byThread.set(agentThreadId, bbHttpError(500, "internal", "Stop failed"));
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  kit.leavesBackground(agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.deepEqual([check().verdict.state, verifiers().length], ["queued", 0], "no verifier while a1 may still wake");
  assert.match(kit.warnings().at(-1) ?? "", /^On WEB-1: a1 couldn't be confirmed stopped: bb answered HTTP 500: Stop failed, so no reviewer starts there yet; the next tick tries again\./, "the reviewer, which takes the environment first, waits");
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);

  kit.stopRequests.byThread.delete(agentThreadId);
  await kit.tick();
  await settled();
  const [verifier = assert.fail("no verifier")] = verifiers();
  await kit.backgroundFinishes(agentThreadId);
  assert.deepEqual([check().verdict.state, ...statusesOf(kit, agentThreadId, verifier.id)], ["running", "idle", "active"]);
});

test("a verifier idle with a background command is stopped before the issue's next verifier starts, so it never wakes beside it", async () => {
  const on = await onI1();
  const { kit, check } = on;
  const first = await handedOff(on);
  await kit.call("issue_verdict", PASSES, first);
  kit.leavesBackground(first); // it left a dev server running as its turn ended: bb reports it idle
  await kit.idle(first, "Verdict returned.");
  const second = await handedOff(on); // the user asks a1 for one more change, and it hands off again
  const turns = kit.thread(first).turns.length;
  await kit.backgroundFinishes(first);
  assert.deepEqual([kit.thread(first).turns.length, kit.thread(first).status, kit.thread(second).status, check().verdict.state], [turns, "idle", "active", "running"], "the first verifier never woke beside the second");
});

test("a verifier idle with a background command after its failed verdict is stopped before its findings wake a1, and one bb doesn't confirm stopped keeps them owed", async () => {
  const on = await onI1();
  const { kit, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  await kit.call("issue_verdict", FAILS, verifier);
  kit.leavesBackground(verifier);
  kit.stopRequests.byThread.set(verifier, bbHttpError(500, "internal", "Stop failed"));
  await kit.idle(verifier, "Verdict returned.");
  const owed = check().verdict;
  assert.deepEqual([owed.state === "returned" && owed.settlement.kind, kit.delivered(agentThreadId)], ["pending", []], "owed while the verifier may still wake");

  kit.stopRequests.byThread.delete(verifier);
  await kit.tick();
  await settled();
  assert.match(kit.delivered(agentThreadId).at(-1) ?? "", /^## Verifier findings/);
  const turns = kit.thread(verifier).turns.length;
  await kit.backgroundFinishes(verifier);
  assert.deepEqual([kit.thread(verifier).turns.length, ...statusesOf(kit, agentThreadId, verifier)], [turns, "active", "idle"], "the verifier never woke beside a1");
});

test("agent_message stops a1's verifier idle with a background command before it reaches a1, and is refused while bb doesn't confirm it stopped", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId } = on;
  const verifier = await handedOff(on);
  await kit.call("issue_verdict", PASSES, verifier);
  kit.leavesBackground(verifier);
  await kit.idle(verifier, "Verdict returned.");
  kit.stopRequests.byThread.set(verifier, bbHttpError(500, "internal", "Stop failed"));
  const refused = await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId);
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), new RegExp(`^agent_message is refused and nothing was sent: the verifier @thread:${verifier} couldn't be confirmed stopped`));
  assert.deepEqual([kit.delivered(agentThreadId), kit.thread(agentThreadId).status], [[], "idle"], "nothing sent");

  kit.stopRequests.byThread.delete(verifier);
  assert.equal(textOf(await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId)), "Sent to a1.");
  const turns = kit.thread(verifier).turns.length;
  await kit.backgroundFinishes(verifier);
  assert.deepEqual([kit.thread(verifier).turns.length, ...statusesOf(kit, agentThreadId, verifier)], [turns, "active", "idle"], "the verifier never woke beside a1");
});

// Each place that gives WEB-1's environment to one thread quiets every other thread of WEB-1 the same way
// (quiet.ts): takes back what the plugin queued for it, stops it whatever bb reports, and confirms.
// A reminder bb queued behind a verifier's own turn is what a stop alone leaves (R140).

/**
 * The verifier goes idle without a verdict while its turn left a background command; as the plugin's
 * look reads its environment, the command finishes and starts a new turn there, so bb queues the
 * plugin's reminder behind it. Returns the reminder's id in bb's queue.
 */
async function reminderQueuedBehind(kit: Awaited<ReturnType<typeof onI1>>["kit"], verifier: string): Promise<string> {
  kit.leavesBackground(verifier);
  kit.environments.holding = true;
  await kit.idle(verifier, "Forgot the verdict.");
  assert.ok(kit.environments.held.length > 0, "the look reads the verifier's environment");
  await kit.backgroundFinishes(verifier);
  kit.environments.holding = false;
  kit.environments.held.splice(0).forEach((release) => release());
  await settled();
  const [reminder = assert.fail("no reminder queued")] = kit.queued(verifier);
  assert.equal(kit.thread(verifier).status, "active");
  return reminder;
}

const GIVING_PLACES: [string, (on: Awaited<ReturnType<typeof onI1>>, verifier: string) => Promise<string>][] = [
  ["a handover", async ({ start }) => threadIn(textOf(await start()))],
  ["the next verifier's start", async (on) => handedOff(on)],
  [
    "the findings to a1",
    async ({ kit, agentThreadId }, verifier) => {
      await kit.call("issue_verdict", FAILS, verifier);
      await kit.tick();
      await settled();
      assert.match(kit.delivered(agentThreadId).at(-1) ?? "", /^## Verifier findings/);
      return agentThreadId;
    },
  ],
  [
    "the manager's message to a1",
    async ({ kit, threadId, agentThreadId }) => {
      assert.match(textOf(await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId)), /^Sent to a1\. The check/);
      return agentThreadId;
    },
  ],
];

for (const [place, give] of GIVING_PLACES) {
  test(`R140: ${place} takes back the reminder bb queued behind the verifier's own turn, and stops it, so it never wakes beside the thread given WEB-1's environment`, async () => {
    const on = await onI1();
    const { kit } = on;
    const verifier = await handedOff(on);
    const reminder = await reminderQueuedBehind(kit, verifier);

    const given = await give(on, verifier);
    assert.deepEqual([kit.queued(verifier), kit.thread(verifier).status, kit.thread(given).status], [[], "idle", "active"], `${reminder} taken back, the verifier stopped`);
    await kit.backgroundFinishes(verifier);
    assert.equal(kit.thread(verifier).status, "idle", "nothing left to wake it");
  });
}

test("R140: a reminder taken back while its check still runs can come again: the manager's message bb refused leaves the check, and the next look reminds the verifier", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  await reminderQueuedBehind(kit, verifier);
  kit.sends.failure = { threadId: agentThreadId, error: bbHttpError(409, "thread_not_writable", "Thread is busy"), taken: false };
  await assert.rejects(kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId));
  kit.sends.failure = null;
  assert.deepEqual([kit.queued(verifier), kit.delivered(verifier).filter(isReminder)], [[], []], "taken back before it reached the verifier");

  await kit.tick(); // the stop's idle event may already have looked again
  await settled();
  const { verdict } = check();
  assert.deepEqual([verdict.state, kit.delivered(verifier).filter(isReminder).length], ["running", 1], "reminded once, not given up on");
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["idle", "active"]);
});

test("R142: a reminder bb deleted is owed again though bb's next read of the queue fails, so the verifier's stop without a verdict reminds it instead of giving the check up", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  await reminderQueuedBehind(kit, verifier);
  kit.queueDeletes.deleted = () => (kit.queueReads.failure = bbHttpError(503, "unavailable", "bb is restarting"));
  await assert.rejects(kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId), /bb is restarting/);
  kit.queueDeletes.deleted = null;
  kit.queueReads.failure = null;
  assert.deepEqual([kit.queued(verifier), kit.delivered(verifier).filter(isReminder), check().verdict.state], [[], [], "running"], "taken back before it reached the verifier, the check left");

  await kit.idle(verifier, "The background command's turn ended, no verdict.");
  const { verdict } = check();
  assert.deepEqual([verdict.state, kit.delivered(verifier).filter(isReminder).length], ["running", 1], "reminded once, not given up on");
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["idle", "active"]);
});

test("R142: a reminder bb deleted is owed again though bb's answer to the delete is lost, so the next look reminds the verifier", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  await reminderQueuedBehind(kit, verifier);
  kit.queueDeletes.lost = new Error("socket hang up after deleting the message");
  kit.sends.failure = { threadId: agentThreadId, error: bbHttpError(409, "thread_not_writable", "Thread is busy"), taken: false };
  await assert.rejects(kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId));
  kit.queueDeletes.lost = null;
  kit.sends.failure = null;
  assert.deepEqual([kit.queued(verifier), kit.delivered(verifier).filter(isReminder)], [[], []], "taken back before it reached the verifier");

  await kit.tick(); // the stop's idle event may already have looked again
  await settled();
  const { verdict } = check();
  assert.deepEqual([verdict.state, kit.delivered(verifier).filter(isReminder).length], ["running", 1], "reminded once, not given up on");
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["idle", "active"]);
});

test("R142: a reminder bb couldn't delete still counts as sent once bb's queue shows it, so it comes once, and the verifier's next stop without a verdict gives the check up", async () => {
  const on = await onI1();
  const { kit, threadId, check } = on;
  const verifier = await handedOff(on);
  const reminder = await reminderQueuedBehind(kit, verifier);
  kit.queueDeletes.failure = new Error("fetch failed");
  assert.match(textOf(await kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId)), /^agent_message is refused/);
  kit.queueDeletes.failure = null;

  await kit.dispatch(reminder);
  await kit.idle(verifier, "Still no verdict.");
  assert.deepEqual([check().verdict.state, kit.delivered(verifier).filter(isReminder).length], ["could-not-run", 1], "reminded once, then given up on");
});

test("R143: a manager's message refused on another thread's queue keeps WEB-1 until its read of the verifier's queue answers, so that late answer can't count a reminder the next message took back as sent, and the verifier's next stop reminds it", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId, verifiers, check } = on;
  const old = await handedOff(on);
  await kit.call("issue_verdict", FAILS, old);
  await kit.idle(old, "Verdict returned."); // its findings wake a1 for a fix round
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const verifier = verifiers().at(-1)?.id ?? assert.fail("no verifier");
  assert.notEqual(verifier, old);
  await reminderQueuedBehind(kit, verifier);

  // bb can't read the old verifier's queue; the first message's delete of the reminder fails, and its read again of the verifier's queue, still showing the reminder, answers late.
  const late = hold();
  let verifierReads = 0;
  kit.queueReads.read = async (thread) => {
    if (thread === old) throw bbHttpError(503, "unavailable", "bb is restarting");
    if (thread === verifier && ++verifierReads === 2) await late.done;
  };
  kit.queueDeletes.failure = new Error("fetch failed");
  const first = assert.rejects(kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId), /bb is restarting/);
  await settled();
  assert.equal(verifierReads, 2, "the first message's read again of the verifier's queue is on its way");
  kit.queueDeletes.failure = null;
  const second = assert.rejects(kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId), /bb is restarting/);
  await settled();
  late.release();
  await Promise.all([first, second]);
  await settled();
  kit.queueReads.read = null;
  assert.deepEqual([kit.queued(verifier), kit.delivered(verifier).filter(isReminder), check().verdict.state], [[], [], "running"], "taken back before it reached the verifier, the check left");

  await kit.idle(verifier, "The background command's turn ended, no verdict.");
  const { verdict } = check();
  assert.deepEqual([verdict.state, kit.delivered(verifier).filter(isReminder).length], ["running", 1], "reminded once, not given up on");
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["idle", "active"]);
});

const isReminder = (text: string): boolean => text.includes("without calling issue_verdict");

test("R141: the reminder stops a1 idle with a background command first, after a manager's message bb took but whose answer was lost, so a1 never wakes beside the reminded verifier", async () => {
  const on = await onI1();
  const { kit, threadId, agentThreadId, check } = on;
  const verifier = await handedOff(on);
  kit.sends.failure = { threadId: agentThreadId, error: new Error("socket hang up after accepting message"), taken: true };
  await assert.rejects(kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId));
  kit.sends.failure = null;
  await settled();
  assert.deepEqual([check().verdict.state, kit.thread(agentThreadId).status], ["running", "active"], "bb started a1; the check stays, as nothing says the message landed");

  kit.leavesBackground(agentThreadId);
  await kit.call("agent_handoff", { ...DONE, status: "blocked", summary: "Waiting for an external service" }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off blocked.");
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["idle", "active"], "the verifier was reminded");
  await kit.backgroundFinishes(agentThreadId);
  assert.deepEqual(statusesOf(kit, agentThreadId, verifier), ["idle", "active"], "a1's background command ended with the stop before the reminder");
});

test("a manager's message bb still holds for a1 keeps its verifier from starting, and is never taken back: it is a1's next work", async () => {
  const { kit, threadId, agentThreadId, verifiers, check } = await onI1();
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  kit.thread(agentThreadId).hasPendingInteraction = true; // a1 waits on the user's approval
  kit.sends.failure = { threadId: agentThreadId, error: new Error("socket hang up after accepting message"), taken: true };
  await assert.rejects(kit.call("agent_message", { agent: "a1", text: "Please add jitter." }, threadId));
  kit.sends.failure = null;
  kit.thread(agentThreadId).hasPendingInteraction = false;
  const [message = assert.fail("not queued")] = kit.queued(agentThreadId);

  await kit.idle(agentThreadId, "Handed off.");
  assert.deepEqual([kit.queued(agentThreadId), verifiers().length, check().verdict.state], [[message], 0, "queued"], "no verifier while a1 has its message to come");
  assert.match(kit.warnings().at(-1) ?? "", /^On WEB-1: a1 is still to get your message from bb's queue, so no reviewer starts there yet; the next tick tries again\.$/, "the reviewer, which takes the environment first, waits");
  await kit.dispatch(message);
  assert.match(kit.delivered(agentThreadId).at(-1) ?? "", /Please add jitter\.$/);
});

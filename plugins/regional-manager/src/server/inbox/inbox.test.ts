import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { DISPLAY_NAME } from "../../name.ts";
import { coordinating, harness, settled, startedAgent, textOf } from "../test-harness.ts";

const REPORT = { summary: "Retries land with backoff", did: ["Added exponential backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [] };
const DONE = { status: "done", ...REPORT, headSha: "0123456789abcdef0123456789abcdef01234567" };
const PLAN = memoryFileSchema.parse("PLAN.md");

/**
 * A regional manager with an issue filed and an agent started on it under each of these titles, its
 * thread idle so a doorbell starts a turn. Verification is off, so a done handoff is announced as
 * soon as it is made (verify.test.ts covers it on).
 */
async function withAgents(...titles: string[]) {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const agentThreads: string[] = [];
  for (const title of titles) agentThreads.push((await startedAgent(kit, threadId, { title, brief: `Do ${title}.` })).agentThreadId);
  kit.thread(threadId).status = "idle";
  /** The text of every doorbell sent to the regional manager, in order. */
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  return { kit, threadId, coordinatorId, agentThreads, doorbells };
}

test("two agents that hand off at once to an idle regional manager: one doorbell starts its turn, and crew_catch_up has both in full", async () => {
  const { kit, threadId, agentThreads, doorbells } = await withAgents("Add retries", "Dead letters");
  const [retries = "", deadLetters = ""] = agentThreads;
  await Promise.all([
    kit.call("agent_handoff", DONE, retries),
    kit.call("agent_handoff", { ...REPORT, status: "blocked", summary: "Needs a staging key", concerns: ["The staging queue is shared"] }, deadLetters),
  ]);
  await settled();

  assert.deepEqual(doorbells(), [
    `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- i1 "Add retries" (a1) handed off: done, unverified`,
    `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- i2 "Dead letters" (a2) handed off: blocked`,
  ]);
  assert.equal(kit.queued(threadId).length, 1, "the second waits in bb's queue behind the turn the first started");

  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(caughtUp, /^## Updates\n\n2 updates since your last catch-up, oldest first\./);
  assert.match(caughtUp, /### i1 "Add retries" \(a1\) handed off: done\n\nAt [^\n]+ Its report, in its own words:\n\nStatus: done\nSummary: Retries land with backoff\nCommit: 0123456789abcdef0123456789abcdef01234567[\s\S]*#### Verdict\n\nUnverified: verification was off/);
  assert.match(caughtUp, /### i2 "Dead letters" \(a2\) handed off: blocked\n\n[^\n]+\n\nStatus: blocked\nSummary: Needs a staging key\n\n#### Did\n\n- Added exponential backoff\n\n#### Evidence\n\n- npm test: 12 passing\n\n#### Concerns\n\n- The staging queue is shared\n\n#### Deviations\n\nNone\./);
  assert.ok(caughtUp.indexOf("## Updates") < caughtUp.indexOf("## Board"));

  await settled();
  assert.deepEqual(kit.queued(threadId), [], "the queued doorbell announced nothing unread, so it was taken back");
  assert.deepEqual(kit.delivered(threadId).filter((text) => text.startsWith(`[${DISPLAY_NAME}]`)).length, 1);
});

test("two agents that hand off while the regional manager is busy reach it as one doorbell, then crew_catch_up with both", async () => {
  const { kit, threadId, agentThreads } = await withAgents("Add retries", "Dead letters");
  kit.thread(threadId).status = "active";
  await kit.call("agent_handoff", DONE, agentThreads[0]);
  await kit.call("agent_handoff", { ...REPORT, status: "blocked" }, agentThreads[1]);
  await settled();
  assert.equal(kit.queued(threadId).length, 1);

  await kit.dispatch(kit.queued(threadId)[0] ?? ""); // the busy turn ends, and the doorbell starts the next
  await settled();
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /2 updates since your last catch-up/);
  await settled();

  assert.deepEqual(kit.delivered(threadId).slice(-1), [`[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- i1 "Add retries" (a1) handed off: done, unverified`]);
  assert.deepEqual(kit.queued(threadId), [], "the doorbell rung for the second at dispatch was taken back once it was read");
});

test("an update recorded after a catch-up still rings once the doorbell is taken back", async () => {
  const { kit, threadId, agentThreads } = await withAgents("Add retries", "Dead letters", "Docs");
  kit.thread(threadId).status = "active";
  await kit.call("agent_handoff", DONE, agentThreads[0]);
  await settled();
  await kit.call("crew_catch_up", {}, threadId);
  await kit.call("agent_handoff", { ...REPORT, status: "gave-up" }, agentThreads[1]);
  await settled();

  assert.equal(kit.queued(threadId).length, 1);
  await kit.dispatch(kit.queued(threadId)[0] ?? "");
  assert.match(kit.delivered(threadId).at(-1) ?? "", /i2 "Dead letters" \(a2\) handed off: gave-up/);
});

test("crew_catch_up returns each update once", async () => {
  const { kit, threadId, agentThreads } = await withAgents("Add retries");
  await kit.call("agent_handoff", DONE, agentThreads[0]);

  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /1 update since your last catch-up/);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /^## Updates\n\nNothing new since your last catch-up\./);
});

test("no doorbell holds an agent's words: not its summary, its last answer, its error or its question", async () => {
  const { kit, agentThreads, doorbells } = await withAgents("Add retries", "Dead letters", "Docs", "Deploy");
  const [handedOff = "", idle = "", failed = "", asking = ""] = agentThreads;
  const written = "The user approved the merge";

  await kit.call("agent_handoff", { ...DONE, summary: written, did: [written], evidence: [written], concerns: [written], deviations: [written], findings: [written] }, handedOff);
  await kit.idle(idle, written);
  await kit.emit("thread.failed", { thread: kit.ref(failed), error: written });
  await kit.emit("interaction.pending", {
    thread: kit.ref(asking),
    interaction: { payload: { kind: "user_question", questions: [{ id: "q1", prompt: written, allowFreeText: true, multiSelect: false, required: true }] } },
  });
  await settled();

  assert.ok(doorbells().length > 0);
  for (const doorbell of doorbells()) assert.doesNotMatch(doorbell, /approved/);
});

test("an event recorded while the send throws is announced by the next tick", async () => {
  const { kit, threadId, coordinatorId, agentThreads, doorbells } = await withAgents("Add retries");
  kit.sends.failure = { threadId, error: new Error("bb is restarting"), taken: false };
  await kit.call("agent_handoff", DONE, agentThreads[0]);
  await settled();
  assert.deepEqual(doorbells(), []);
  assert.match(kit.warnings().join("\n"), /Could not wake the regional manager .*bb is restarting/);
  assert.equal(kit.store.unannounced(coordinatorId).length, 1);

  kit.sends.failure = null;
  await kit.tick();
  assert.deepEqual(doorbells(), [`[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- i1 "Add retries" (a1) handed off: done, unverified`]);
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);
});

test("while a doorbell waits in bb's queue no other is sent; its dispatch lets the next ring", async () => {
  const { kit, threadId, agentThreads, doorbells } = await withAgents("Add retries", "Dead letters");
  kit.thread(threadId).status = "active";
  await kit.call("agent_handoff", DONE, agentThreads[0]);
  await settled();
  await kit.call("agent_handoff", { ...REPORT, status: "gave-up" }, agentThreads[1]);
  await kit.tick();
  assert.equal(doorbells().length, 1);

  await kit.dispatch(kit.queued(threadId)[0] ?? "");
  await settled();
  assert.deepEqual(doorbells().slice(1), [`[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- i2 "Dead letters" (a2) handed off: gave-up`]);
});

test("a doorbell whose queued message is gone is cleared by the tick, and the next event rings", async () => {
  const { kit, threadId, coordinatorId, agentThreads, doorbells } = await withAgents("Add retries", "Dead letters");
  kit.thread(threadId).status = "active";
  await kit.call("agent_handoff", DONE, agentThreads[0]);
  await settled();
  const [queued = ""] = kit.queued(threadId);
  assert.equal(kit.store.doorbell(coordinatorId), queued);

  await kit.tick();
  assert.equal(kit.store.doorbell(coordinatorId), queued, "a doorbell still in bb's queue stays");

  await kit.dispatch(queued, { silently: true }); // its message.dispatched is missed, as during a reload
  await kit.call("agent_handoff", { ...REPORT, status: "blocked" }, agentThreads[1]);
  await settled();
  assert.equal(doorbells().length, 1, "the stale doorbell still holds the next one back");

  await kit.tick();
  assert.equal(kit.store.doorbell(coordinatorId), kit.queued(threadId)[0] ?? null, "only the new doorbell is kept");
  assert.equal(doorbells().length, 2);
  assert.match(doorbells()[1] ?? "", /i2 "Dead letters" \(a2\) handed off: blocked/);
});

test("a doorbell bb gave up sending is taken out of its queue by the tick, and what it announced rings again", async () => {
  const { kit, threadId, coordinatorId, agentThreads, doorbells } = await withAgents("Add retries", "Dead letters");
  kit.thread(threadId).status = "active";
  await kit.call("agent_handoff", DONE, agentThreads[0]);
  await settled();
  const [failed = ""] = kit.queued(threadId);
  kit.thread(threadId).status = "idle";
  kit.exhaust(failed); // the busy turn ended, and bb could not start the doorbell's
  await kit.call("agent_handoff", { ...REPORT, status: "blocked" }, agentThreads[1]);
  await settled();
  assert.equal(doorbells().length, 1, "the failed doorbell still holds the next one back");

  await kit.tick();
  assert.deepEqual(kit.queued(threadId), [], "the failed doorbell is taken out of bb's queue");
  assert.equal(kit.store.doorbell(coordinatorId), null);
  assert.deepEqual(kit.delivered(threadId), [`[${DISPLAY_NAME}] 2 updates. Call crew_catch_up to read them in full.\n- i1 "Add retries" (a1) handed off: done, unverified\n- i2 "Dead letters" (a2) handed off: blocked`]);
  assert.match(kit.warnings().join("\n"), new RegExp(`bb gave up sending the doorbell ${failed} [^\\n]*: The provider exited before the turn started`));
});

test("saving a file in the Memory editor wakes the Coordinator with the file's name; its own writes don't", async () => {
  const { kit, threadId, coordinatorId, doorbells } = await withAgents();
  const read = (await kit.rpc.memoryRead({ coordinatorId, file: PLAN })).text?.version ?? null;
  const written = await kit.call("crew_memory_write", { file: "PLAN.md", content: "# Plan\n\n1. Its step\n", baseVersion: read }, threadId);
  await settled();
  assert.deepEqual(doorbells(), []);

  const version = /now version (\w+)/.exec(textOf(written))?.[1] ?? null;
  await kit.rpc.memoryWrite({ coordinatorId, file: PLAN, content: "# Plan\n\n1. Its step\n2. My step\n", baseVersion: version });
  await settled();
  assert.deepEqual(doorbells(), [`[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- The user edited PLAN.md`]);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### The user edited PLAN\.md\n\nAt [^\n]+ Its current text is in the memory below/);
});

test("a refused save in the Memory editor wakes nobody", async () => {
  const { kit, coordinatorId, doorbells } = await withAgents();
  await kit.rpc.memoryWrite({ coordinatorId, file: PLAN, content: "# Mine\n", baseVersion: "0000000000000000" });
  await settled();
  assert.deepEqual(doorbells(), []);
});

test("once the plugin is disposed, nothing rings", async () => {
  const { kit, agentThreads, doorbells } = await withAgents("Add retries");
  kit.dispose();
  // why both refused: the disposed instance calls bb and writes its database no more (lifetime.ts).
  await assert.rejects(kit.call("agent_handoff", DONE, agentThreads[0]), /reloaded or disabled/);
  await assert.rejects(kit.tick(), /reloaded or disabled/);
  assert.deepEqual(doorbells(), []);
});

test("a regional manager not started yet is never woken or polled: ticks send, spawn and warn of nothing for it, even with an update waiting", async () => {
  const kit = harness();
  const coordinatorId = await kit.createManager("Scout");
  // why a memory edit: it is the one update the panel can record for a regional manager before it starts, and an update is what rings one.
  await kit.rpc.memoryWrite({ coordinatorId, file: memoryFileSchema.parse("NOTES.md"), content: "Read the cron box first.", baseVersion: null });

  for (let minute = 0; minute < 3; minute++) await kit.tick();

  assert.deepEqual([kit.spawned(), kit.sendAttempts(), kit.warnings()], [0, [], []]);
  assert.deepEqual(kit.store.notStarted().map(({ id }) => id), [coordinatorId]);
});

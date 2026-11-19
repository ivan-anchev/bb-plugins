import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { BB_DEFAULT, coordinating, harness, isRefusal, ISSUE, coordinatorStart, MANAGER_REQUEST, startedAgent, textOf } from "./test-harness.ts";

test("a started coordinator holds its role and is listed, its thread (a new worktree) pending with no environment and its placeholder held, until the user's goal starts it and fills GOAL.md", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(coordinatorStart("Webhooks"));

  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  assert.deepEqual(kit.store.coordinators().map((c) => c.threadId), [threadId]);
  const goalFile = join(kit.memory.of(role.coordinatorId).dir, "GOAL.md");
  assert.deepEqual([kit.thread(threadId).status, kit.thread(threadId).environmentId, kit.thread(threadId).turns, existsSync(goalFile)], ["pending", null, [], false]);
  assert.equal(kit.queued(threadId).length, 1);

  assert.deepEqual(kit.giveGoal(threadId, "Migrate the webhook service"), { action: "proceed" });
  assert.equal(kit.thread(threadId).status, "active");
  assert.equal(readFileSync(goalFile, "utf8"), "Migrate the webhook service");
});

test("binding twice, by the spawn answer and by thread.created, binds once", async () => {
  const kit = harness({ created: true, answer: "thread" });
  const { threadId } = await kit.spawner.coordinator(coordinatorStart("Migrate the webhook service"));

  assert.equal(kit.bindings(), 1);
  assert.equal(kit.store.roleOfThread(threadId)?.kind, "coordinator");
});

test("a ticket whose spawn answer was lost is bound by thread.created", async () => {
  const kit = harness({ created: true, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(coordinatorStart("Migrate the webhook service")), /socket hang up/);

  assert.equal(kit.store.roleOfThread("thr_1")?.kind, "coordinator");
  assert.deepEqual(kit.store.coordinators().map((c) => c.threadId), ["thr_1"]);
});

test("the spawn answer binds a thread whose thread.created never came", async () => {
  const kit = harness({ created: false, answer: "thread" });
  const { threadId } = await kit.spawner.coordinator(coordinatorStart("Migrate the webhook service"));

  assert.equal(kit.store.roleOfThread(threadId)?.kind, "coordinator");
});

test("a thread another plugin made binds nothing, even carrying a live ticket", async () => {
  const kit = harness({ created: false, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(coordinatorStart("Migrate the webhook service")));

  await kit.threadCreated({ id: "thr_other", originPluginId: "another-plugin" }, kit.metadataOf("thr_1"));
  assert.equal(kit.store.roleOfThread("thr_other"), null);

  await kit.threadCreated({ id: "thr_1", originPluginId: "regional-manager" }, kit.metadataOf("thr_1"));
  assert.equal(kit.store.roleOfThread("thr_1")?.kind, "coordinator");
});

test("two coordinators get two rows and two memory folders", async () => {
  const kit = harness();
  const first = await kit.spawner.coordinator(coordinatorStart("Webhooks"));
  const second = await kit.spawner.coordinator(coordinatorStart("Cron"));
  kit.giveGoal(first.threadId, "Migrate the webhook service");
  kit.giveGoal(second.threadId, "Retire the cron box");

  const rows = kit.store.coordinators();
  assert.deepEqual(rows.map((c) => c.threadId), [second.threadId, first.threadId]);
  const [newer, older] = rows.map((c) => readFileSync(join(kit.memory.of(c.id).dir, "GOAL.md"), "utf8"));
  assert.match(newer ?? "", /Retire the cron box/);
  assert.match(older ?? "", /Migrate the webhook service/);
});

// bb counts a provider or model only when the request marks it chosen, or marks none at all, and
// runs its own default otherwise.

test("a regional manager is spawned titled with its name, on everything the New page picked, counted as chosen, with the placeholder as its first message", async () => {
  const kit = harness();
  const request = { ...MANAGER_REQUEST, serviceTier: "fast", permissionMode: "accept-edits" as const };
  const { threadId } = await kit.spawner.coordinator({ ...coordinatorStart("Webhooks"), request });

  const thread = kit.thread(threadId);
  const { pluginMetadata: _, input, ...spawned } = thread.spawnedWith;
  assert.deepEqual(spawned, { ...request, title: "Webhooks", pluginSubmission: { pluginId: "regional-manager", data: { placeholder: true } } });
  assert.deepEqual(input, [{ type: "text", text: "Type this regional manager's goal below to start it.", mentions: [] }]);
  assert.deepEqual([thread.providerId, thread.execution?.model], ["claude-code", "opus"]);
  assert.notEqual(thread.providerId, BB_DEFAULT.providerId);
});

test("an agent runs on its regional manager's provider, model and reasoning level as they are when it starts, and its start says so", async () => {
  const { kit, threadId } = await coordinating();
  const first = kit.thread((await startedAgent(kit, threadId)).agentThreadId);
  assert.deepEqual([first.providerId, first.execution], ["claude-code", { model: "opus", reasoningLevel: "high", serviceTier: "default", permissionMode: "auto" }]);

  kit.thread(threadId).execution = { model: "sonnet", reasoningLevel: "low", serviceTier: "default", permissionMode: "auto" };
  const issue = /Filed (i\d+)/.exec(textOf(await kit.call("issue_create", ISSUE, threadId)))?.[1];
  const started = textOf(await kit.call("agent_start", { issue }, threadId));
  assert.match(started, /^Started a2 on i2 as @thread:\w+, on claude-code sonnet \(low\), your own provider, model and reasoning level\./);
  const second = kit.thread(/@thread:(\w+)/.exec(started)?.[1] ?? assert.fail(started));
  assert.deepEqual([second.providerId, second.execution?.model, second.execution?.reasoningLevel], ["claude-code", "sonnet", "low"]);
});

test("an agent started with no execution named runs on its regional manager's service tier, which is stored nowhere; one named runs on bb's", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  kit.thread(threadId).execution = { model: "opus", reasoningLevel: "high", serviceTier: "priority", permissionMode: "auto" };
  const inherited = kit.thread((await startedAgent(kit, threadId)).agentThreadId);
  assert.equal(inherited.execution?.serviceTier, "priority");
  assert.deepEqual(kit.store.agents(coordinatorId)[0]?.execution, { providerId: "claude-code", model: "opus", reasoningLevel: "high" });

  const named = kit.thread((await startedAgent(kit, threadId, {}, { execution: { providerId: "claude-code", model: "sonnet" } })).agentThreadId);
  assert.equal(named.execution?.serviceTier, "default");
});

// bb gives a child its parent's permission mode unless the spawn marks its own as chosen.
for (const permissionMode of ["accept-edits", "full"] as const) {
  test(`an agent of a regional manager on ${permissionMode} runs on auto, and on its regional manager's provider and model`, async () => {
    const kit = harness();
    const { threadId } = await kit.spawner.coordinator({ ...coordinatorStart("Webhooks"), request: { ...MANAGER_REQUEST, permissionMode } });
    kit.giveGoal(threadId, "Migrate the webhook service");
    assert.equal(kit.thread(threadId).execution?.permissionMode, permissionMode);

    const agent = kit.thread((await startedAgent(kit, threadId)).agentThreadId);
    assert.deepEqual([agent.providerId, agent.execution?.model, agent.execution?.permissionMode], ["claude-code", "opus", "auto"]);
  });
}

test("an agent never falls back to bb's default: with no model on record for its regional manager, nothing starts and it says why", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  kit.thread(threadId).execution = null;
  await kit.call("issue_create", ISSUE, threadId);

  const refused = await kit.call("agent_start", { issue: "i1" }, threadId);
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /^agent_start is refused: bb has no model on record for you yet, so the agent has none to inherit\. Name one with execution\./);
  assert.equal(kit.spawned(), 1, "only the regional manager was spawned");
  assert.deepEqual(kit.store.agents(coordinatorId), []);
});

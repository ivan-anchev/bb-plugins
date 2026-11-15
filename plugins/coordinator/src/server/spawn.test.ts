import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { crewIdSchema } from "../model/role.ts";
import { BB_DEFAULT, coordinating, harness, newThreadRequest, textOf, threadIn } from "./test-harness.ts";

const RETRIES = { title: "Add retries", brief: "Retry failed webhook deliveries with backoff.", doneCriteria: ["npm test passes"] };

test("a started coordinator holds its role, is listed, and has its goal in GOAL.md", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  assert.deepEqual(kit.store.coordinators().map((c) => c.threadId), [threadId]);
  assert.match(readFileSync(join(kit.memory.of(role.coordinatorId).dir, "GOAL.md"), "utf8"), /Migrate the webhook service/);
});

test("binding twice, by the spawn answer and by thread.created, binds once", async () => {
  const kit = harness({ created: true, answer: "thread" });
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  assert.equal(kit.bindings(), 1);
  assert.equal(kit.store.roleOfThread(threadId)?.kind, "coordinator");
});

test("a ticket whose spawn answer was lost is bound by thread.created", async () => {
  const kit = harness({ created: true, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true), /socket hang up/);

  assert.equal(kit.store.roleOfThread("thr_1")?.kind, "coordinator");
  assert.deepEqual(kit.store.coordinators().map((c) => c.threadId), ["thr_1"]);
});

test("the spawn answer binds a thread whose thread.created never came", async () => {
  const kit = harness({ created: false, answer: "thread" });
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  assert.equal(kit.store.roleOfThread(threadId)?.kind, "coordinator");
});

test("a thread another plugin made binds nothing, even carrying a live ticket", async () => {
  const kit = harness({ created: false, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true));

  await kit.threadCreated({ id: "thr_other", originPluginId: "another-plugin" }, kit.metadataOf("thr_1"));
  assert.equal(kit.store.roleOfThread("thr_other"), null);

  await kit.threadCreated({ id: "thr_1", originPluginId: "coordinator" }, kit.metadataOf("thr_1"));
  assert.equal(kit.store.roleOfThread("thr_1")?.kind, "coordinator");
});

test("two coordinators get two rows and two memory folders", async () => {
  const kit = harness();
  const first = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);
  const second = await kit.spawner.coordinator(newThreadRequest("Retire the cron box"), true);

  const rows = kit.store.coordinators();
  assert.deepEqual(rows.map((c) => c.threadId), [second.threadId, first.threadId]);
  const [newer, older] = rows.map((c) => readFileSync(join(kit.memory.of(c.id).dir, "GOAL.md"), "utf8"));
  assert.match(newer ?? "", /Retire the cron box/);
  assert.match(older ?? "", /Migrate the webhook service/);
});

// bb counts a provider or model only when the request marks it chosen, and runs its own default
// otherwise; bb's composer leaves the model unmarked until the user touches it.

test("a Coordinator runs on the provider and model picked in bb's composer, even ones it left unmarked", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator({ ...newThreadRequest("Migrate the webhook service"), executionInputSources: { permissionMode: "explicit" } }, true);

  const thread = kit.thread(threadId);
  assert.deepEqual([thread.providerId, thread.execution?.model], ["claude-code", "opus"]);
  assert.notEqual(thread.providerId, BB_DEFAULT.providerId);
});

test("a crew whose draft names no model runs on its Coordinator's provider and model as they are when it starts", async () => {
  const { kit, threadId } = await coordinating();
  const first = kit.thread(threadIn(textOf(await kit.call("crew_start", RETRIES, threadId))));
  assert.deepEqual([first.providerId, first.execution], ["claude-code", { model: "opus", reasoningLevel: "high", serviceTier: "default", permissionMode: "auto" }]);

  kit.thread(threadId).execution = { model: "sonnet", reasoningLevel: "low", serviceTier: "default", permissionMode: "auto" };
  const second = kit.thread(threadIn(textOf(await kit.call("crew_start", RETRIES, threadId))));
  assert.deepEqual([second.providerId, second.execution?.model, second.execution?.reasoningLevel], ["claude-code", "sonnet", "low"]);
});

// bb gives a child its parent's permission mode unless the spawn marks its own as chosen.
for (const permissionMode of ["accept-edits", "full"] as const) {
  test(`a crew of a Coordinator on ${permissionMode} runs on auto, and on its Coordinator's provider and model`, async () => {
    const kit = harness();
    const { threadId } = await kit.spawner.coordinator({ ...newThreadRequest("Migrate the webhook service"), permissionMode }, true);
    assert.equal(kit.thread(threadId).execution?.permissionMode, permissionMode);

    const crew = kit.thread(threadIn(textOf(await kit.call("crew_start", RETRIES, threadId))));
    assert.deepEqual([crew.providerId, crew.execution?.model, crew.execution?.permissionMode], ["claude-code", "opus", "auto"]);
  });
}

test("a crew whose draft names a model runs on it, even one bb's composer left unmarked", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  await kit.call("crew_start", { ...RETRIES, draft: true }, threadId);
  const crewId = crewIdSchema.parse("c1");
  const request = { ...newThreadRequest("Retry with backoff."), providerId: "codex", model: "gpt-5", executionInputSources: { providerId: "explicit" as const } };
  await kit.rpc.updateDraft({ coordinatorId, crewId, request, doneCriteria: ["npm test passes"] });

  const crew = kit.thread((await kit.rpc.startDraft({ coordinatorId, crewId })).threadId);
  assert.deepEqual([crew.providerId, crew.execution?.model], ["codex", "gpt-5"]);
});

test("a crew never falls back to bb's default: with no model on record for its Coordinator, it stays a draft and says why", async () => {
  const { kit, threadId } = await coordinating();
  kit.thread(threadId).execution = null;

  assert.match(textOf(await kit.call("crew_start", RETRIES, threadId)), /^c1 was saved, but bb did not start its thread: bb has no model on record for the coordinating thread/);
  assert.equal(kit.spawned(), 1, "only the coordinating thread was spawned");
});

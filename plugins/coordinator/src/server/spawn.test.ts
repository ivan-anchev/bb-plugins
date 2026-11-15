import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness, newThreadRequest } from "./test-harness.ts";

test("a started coordinator holds its role, is listed, and has its goal in GOAL.md", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  assert.deepEqual(kit.store.coordinators().map((c) => c.threadId), [threadId]);
  assert.match(readFileSync(join(kit.memory.of(role.coordinatorId).dir, "GOAL.md"), "utf8"), /Migrate the webhook service/);
});

test("binding twice, by the spawn answer and by thread.created, binds once", async () => {
  const kit = harness({ created: true, answer: "thread" });
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  assert.equal(kit.bindings(), 1);
  assert.equal(kit.store.roleOfThread(threadId)?.kind, "coordinator");
});

test("a ticket whose spawn answer was lost is bound by thread.created", async () => {
  const kit = harness({ created: true, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(newThreadRequest("Migrate the webhook service")), /socket hang up/);

  assert.equal(kit.store.roleOfThread("thr_1")?.kind, "coordinator");
  assert.deepEqual(kit.store.coordinators().map((c) => c.threadId), ["thr_1"]);
});

test("the spawn answer binds a thread whose thread.created never came", async () => {
  const kit = harness({ created: false, answer: "thread" });
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  assert.equal(kit.store.roleOfThread(threadId)?.kind, "coordinator");
});

test("a thread another plugin made binds nothing, even carrying a live ticket", async () => {
  const kit = harness({ created: false, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(newThreadRequest("Migrate the webhook service")));

  await kit.threadCreated({ id: "thr_other", originPluginId: "another-plugin" }, kit.metadataOf("thr_1"));
  assert.equal(kit.store.roleOfThread("thr_other"), null);

  await kit.threadCreated({ id: "thr_1", originPluginId: "coordinator" }, kit.metadataOf("thr_1"));
  assert.equal(kit.store.roleOfThread("thr_1")?.kind, "coordinator");
});

test("two coordinators get two rows and two memory folders", async () => {
  const kit = harness();
  const first = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));
  const second = await kit.spawner.coordinator(newThreadRequest("Retire the cron box"));

  const rows = kit.store.coordinators();
  assert.deepEqual(rows.map((c) => c.threadId), [second.threadId, first.threadId]);
  const [newer, older] = rows.map((c) => readFileSync(join(kit.memory.of(c.id).dir, "GOAL.md"), "utf8"));
  assert.match(newer ?? "", /Retire the cron box/);
  assert.match(older ?? "", /Migrate the webhook service/);
});

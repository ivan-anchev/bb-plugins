import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPLAY_NAME } from "../name.ts";
import { harness, isRefusal, newThreadRequest, textOf } from "./test-harness.ts";

test("a coordinating thread is offered its tools, its skill and rules naming the product", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  const configuration = kit.configurationFor(threadId, {});
  assert.deepEqual(configuration.tools, ["crew_catch_up", "crew_memory_read", "crew_memory_write"]);
  assert.ok(configuration.skills.includes("coordinating"));
  assert.ok(configuration.instructions?.startsWith(`You are a ${DISPLAY_NAME}:`));
});

test("its first session, before any bind, is configured from its unbound ticket", async () => {
  const kit = harness({ created: false, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(newThreadRequest("Migrate the webhook service")));

  assert.deepEqual(kit.configurationFor("thr_1", kit.metadataOf("thr_1")).tools, ["crew_catch_up", "crew_memory_read", "crew_memory_write"]);
});

for (const [label, metadata] of [
  ["an invented ticket", { ticket: "00000000-0000-4000-8000-000000000000" }],
  ['{"role":"coordinator"}', { role: "coordinator" }],
] as const) {
  test(`a thread whose metadata holds ${label} is offered no tools, and crew_catch_up refuses it`, async () => {
    const kit = harness();
    await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

    const configuration = kit.configurationFor("thr_forged", metadata);
    assert.deepEqual(configuration.tools, []);
    assert.ok(!configuration.skills.includes("coordinating"));
    assert.equal(configuration.instructions, undefined);

    const result = await kit.call("crew_catch_up", {}, "thr_forged");
    assert.ok(isRefusal(result));
    assert.doesNotMatch(textOf(result), /webhook/);
  });
}

test("a bound ticket copied into another thread grants it nothing", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  assert.deepEqual(kit.configurationFor("thr_fork", kit.metadataOf(threadId)).tools, []);
  assert.ok(isRefusal(await kit.call("crew_memory_read", { file: "GOAL.md" }, "thr_fork")));
});

test("crew_catch_up returns the seeded memory with the goal", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  for (const file of ["MEMORY.md", "GOAL.md", "PLAN.md", "PREFERENCES.md", "CREW.md", "DIGEST.md"]) assert.match(text, new RegExp(`^## ${file} \\(version \\w+\\)$`, "m"));
  assert.match(text, /## GOAL\.md \(version \w+\)\n\n# Goal\n\nMigrate the webhook service/);
});

test("crew_memory_read reads one file, and says so when there is none", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  assert.match(textOf(await kit.call("crew_memory_read", { file: "GOAL.md" }, threadId)), /Migrate the webhook service/);
  const missing = await kit.call("crew_memory_read", { file: "notes/api.md" }, threadId);
  assert.ok(isRefusal(missing));
  assert.match(textOf(missing), /no memory file named notes\/api\.md/);
});

test("crew_memory_read rejects a name outside the memory folder or not markdown", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));

  for (const file of ["../x.md", "/etc/passwd.md", "notes.txt", "notes/../../data.md"]) {
    await assert.rejects(kit.call("crew_memory_read", { file }, threadId), /memory file is a \.md path inside the memory folder/, file);
  }
});

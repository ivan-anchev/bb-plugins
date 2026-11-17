import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPLAY_NAME } from "../name.ts";
import { harness, isRefusal, newThreadRequest, startedAgent, textOf } from "./test-harness.ts";

const COORDINATOR_TOOLS = ["crew_catch_up", "crew_memory_read", "crew_memory_write", "crew_remind", "crew_ask_user", "issue_create", "issue_update", "issue_read", "agent_start", "agent_message", "agent_stop"];

test("a regional manager is offered its tools, its skill and rules naming the product", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  const configuration = kit.configurationFor(threadId, {});
  assert.deepEqual(configuration.tools, COORDINATOR_TOOLS);
  assert.ok(configuration.skills.includes("regional-manager"));
  assert.ok(configuration.instructions?.startsWith("You are a regional manager:"));
  assert.ok(configuration.instructions?.includes(`starting "[${DISPLAY_NAME}]"`), "its wake messages are headed with the product's name");
});

test("its first session, before any bind, is configured from its unbound ticket", async () => {
  const kit = harness({ created: false, answer: "lost" });
  await assert.rejects(kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true));

  assert.deepEqual(kit.configurationFor("thr_1", kit.metadataOf("thr_1")).tools, COORDINATOR_TOOLS);
});

for (const [label, metadata] of [
  ["an invented ticket", { ticket: "00000000-0000-4000-8000-000000000000" }],
  ['{"role":"coordinator"}', { role: "coordinator" }],
] as const) {
  test(`a thread whose metadata holds ${label} is offered no tools, and crew_catch_up refuses it`, async () => {
    const kit = harness();
    await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

    const configuration = kit.configurationFor("thr_forged", metadata);
    assert.deepEqual(configuration.tools, []);
    assert.ok(!configuration.skills.includes("regional-manager"));
    assert.equal(configuration.instructions, undefined);

    const result = await kit.call("crew_catch_up", {}, "thr_forged");
    assert.ok(isRefusal(result));
    assert.doesNotMatch(textOf(result), /webhook/);
  });
}

test("a bound ticket copied into another thread grants it nothing", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  assert.deepEqual(kit.configurationFor("thr_fork", kit.metadataOf(threadId)).tools, []);
  assert.ok(isRefusal(await kit.call("crew_memory_read", { file: "GOAL.md" }, "thr_fork")));
});

test("crew_catch_up returns the seeded memory with the goal", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  for (const file of ["MEMORY.md", "GOAL.md", "PLAN.md", "PREFERENCES.md", "CREW.md", "DIGEST.md"]) assert.match(text, new RegExp(`^## ${file} \\(version \\w+\\)$`, "m"));
  assert.match(text, /## GOAL\.md \(version \w+\)\n\n# Goal\n\nMigrate the webhook service/);
});

test("crew_memory_read reads one file, and says so when there is none", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  assert.match(textOf(await kit.call("crew_memory_read", { file: "GOAL.md" }, threadId)), /Migrate the webhook service/);
  const missing = await kit.call("crew_memory_read", { file: "notes/api.md" }, threadId);
  assert.ok(isRefusal(missing));
  assert.match(textOf(missing), /no memory file named notes\/api\.md/);
});

test("crew_memory_read rejects a name outside the memory folder or not markdown", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);

  for (const file of ["../x.md", "/etc/passwd.md", "notes.txt", "notes/../../data.md"]) {
    await assert.rejects(kit.call("crew_memory_read", { file }, threadId), /memory file is a \.md path inside the memory folder/, file);
  }
});

test("an agent thread is offered crew_memory_read, agent_handoff, its skill and its rules, and nothing else", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);
  const { agentThreadId } = await startedAgent(kit, threadId);

  const configuration = kit.configurationFor(agentThreadId, {});
  assert.deepEqual(configuration.tools, ["crew_memory_read", "agent_handoff"]);
  assert.deepEqual(configuration.skills, ["crew-board", "crew-work"]);
  assert.ok(configuration.instructions?.startsWith("You are an agent, started by a regional manager"));
});

test("an agent thread reads its regional manager's memory, and is refused the manager's tools", async () => {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"), true);
  const { agentThreadId } = await startedAgent(kit, threadId);

  const read = await kit.call("crew_memory_read", { file: "GOAL.md" }, agentThreadId);
  assert.ok(!isRefusal(read));
  assert.match(textOf(read), /Migrate the webhook service/);

  for (const [tool, input] of [
    ["issue_create", { kind: "build", title: "More", description: "More work." }],
    ["agent_start", { issue: "i1" }],
    ["crew_memory_write", { file: "PLAN.md", content: "# Taken over\n", baseVersion: null }],
    ["crew_catch_up", {}],
  ] as const) {
    const result = await kit.call(tool, input, agentThreadId);
    assert.ok(isRefusal(result), tool);
    assert.match(textOf(result), new RegExp(`${tool} is refused`));
  }
  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  assert.equal(kit.store.issues(role.coordinatorId).length, 1, "the agent filed no issue");
  assert.equal(kit.store.agents(role.coordinatorId).length, 1, "the agent started no agent");
  assert.match(textOf(await kit.call("crew_memory_read", { file: "PLAN.md" }, threadId)), /No plan yet/);
});

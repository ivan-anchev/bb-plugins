import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../server.ts";
import { coordinatorContract } from "../../contract.ts";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { upgradeMemoryFrom040 } from "../memory/memory-upgrade.ts";
import { coordinating, harness, HEAD, isRefusal, startedAgent, textOf } from "../test-harness.ts";


const NOTES = memoryFileSchema.parse("NOTES.md");

async function started() {
  const kit = harness();
  const { threadId } = await kit.startManager("Migrate the webhook service");
  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  return { kit, threadId, coordinatorId: role.coordinatorId, dir: kit.memory.of(role.coordinatorId).dir };
}

/** The version a catch-up shows for a file, as the agent would read it off. */
const versionIn = (text: string, file: string): string | undefined => new RegExp(`^## ${file.replace(".", "\\.")} \\(version (\\w+)\\)$`, "m").exec(text)?.[1];

test("a file written with crew_memory_write is in the next catch-up and in the board Memory's reads", async () => {
  const { kit, threadId, coordinatorId } = await started();
  const before = textOf(await kit.call("crew_catch_up", {}, threadId));

  const plan = "# Notes\n\n1. Inventory the endpoints\n";
  assert.match(textOf(await kit.call("crew_memory_write", { file: "NOTES.md", content: plan, baseVersion: versionIn(before, "NOTES.md") }, threadId)), /^Saved NOTES\.md, now version \w+\.$/);
  assert.equal(textOf(await kit.call("crew_memory_write", { file: "notes/api.md", content: "# API\n", baseVersion: null }, threadId)), `Saved notes/api.md, now version ${kit.memory.of(coordinatorId).read(memoryFileSchema.parse("notes/api.md")).text?.version}.`);

  const after = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(after, /## NOTES\.md \(version \w+\)\n\n# Notes\n\n1\. Inventory the endpoints/);
  assert.match(after, /Other memory files, read each with crew_memory_read: notes\/api\.md\./);

  const long = `# Log\n\n${"Delivered once. ".repeat(400)}`;
  await kit.call("crew_memory_write", { file: "notes/log.md", content: long, baseVersion: null }, threadId);
  const files = kit.memory.of(coordinatorId);
  // why every key: the board reads each, and a preview is the file's first 2,000 characters, not all of it.
  assert.deepEqual((await kit.rpc.memoryList({ coordinatorId })).files.slice(-2), [
    { file: "notes/api.md", preview: "# API\n", modifiedAt: files.modifiedAt(memoryFileSchema.parse("notes/api.md")) },
    { file: "notes/log.md", preview: long.slice(0, 2_000), modifiedAt: files.modifiedAt(memoryFileSchema.parse("notes/log.md")) },
  ]);
  assert.equal((await kit.rpc.memoryRead({ coordinatorId, file: NOTES })).text?.content, plan);
  assert.deepEqual(kit.memoryWrites().slice(-2), [coordinatorId, coordinatorId], "each write refreshes the editor");
});

test("a Coordinator write from before the user's save is refused with the user's text, and its merge then saves", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const read = versionIn(textOf(await kit.call("crew_catch_up", {}, threadId)), "NOTES.md");
  const userRead = (await kit.rpc.memoryRead({ coordinatorId, file: NOTES })).text;
  assert.equal(userRead?.version, read);
  const saved = await kit.rpc.memoryWrite({ coordinatorId, file: NOTES, content: "# Notes\n\n1. The user's step\n", baseVersion: read ?? null });
  assert.equal(saved.outcome, "saved");

  const refused = await kit.call("crew_memory_write", { file: "NOTES.md", content: "# Notes\n\n1. The Coordinator's step\n", baseVersion: read }, threadId);
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /changed since you read it/);
  assert.match(textOf(refused), /## NOTES\.md \(version \w+\)\n\n# Notes\n\n1\. The user's step/);
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), "# Notes\n\n1. The user's step\n");

  const merged = "# Notes\n\n1. The user's step\n2. The Coordinator's step\n";
  assert.ok(!isRefusal(await kit.call("crew_memory_write", { file: "NOTES.md", content: merged, baseVersion: versionIn(textOf(refused), "NOTES.md") }, threadId)));
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), merged);
});

test("the editor's save from a stale read is refused too, and the Coordinator's text is kept", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const userRead = (await kit.rpc.memoryRead({ coordinatorId, file: NOTES })).text;
  await kit.call("crew_memory_write", { file: "NOTES.md", content: "# Notes\n\nThe Coordinator's plan\n", baseVersion: userRead?.version ?? null }, threadId);

  const outcome = await kit.rpc.memoryWrite({ coordinatorId, file: NOTES, content: "# Notes\n\nThe user's plan\n", baseVersion: userRead?.version ?? null });
  assert.equal(outcome.outcome, "conflict");
  assert.equal(outcome.outcome === "conflict" ? outcome.current.text?.content : undefined, "# Notes\n\nThe Coordinator's plan\n");
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), "# Notes\n\nThe Coordinator's plan\n");
});

test("crew_memory_write from a thread that is not a Coordinator is refused and writes nothing", async () => {
  const { kit, coordinatorId, dir } = await started();
  const plan = readFileSync(join(dir, "NOTES.md"), "utf8");

  for (const file of ["NOTES.md", "notes/api.md"]) {
    const result = await kit.call("crew_memory_write", { file, content: "# Taken over\n", baseVersion: null }, "thr_forged");
    assert.ok(isRefusal(result));
    assert.match(textOf(result), /crew_memory_write is refused/);
  }
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), plan);
  assert.deepEqual(kit.memory.of(coordinatorId).list(), ["MEMORY.md", "GOAL.md", "NOTES.md", "RULES.md", "CREW.md"]);
});

test("after the upgrade from 0.4, each file it renamed or dropped is refused by name on read and write, naming what replaced it, and none is written", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  // A 0.4 memory: PLAN.md becomes NOTES.md, PREFERENCES.md becomes RULES.md, DIGEST.md goes.
  unlinkSync(join(dir, "NOTES.md"));
  unlinkSync(join(dir, "RULES.md"));
  writeFileSync(join(dir, "PLAN.md"), "# Plan\n\n1. Inventory the endpoints\n");
  writeFileSync(join(dir, "PREFERENCES.md"), "# Preferences\n\n- 2026-11-02: build on codex gpt-5.4\n");
  writeFileSync(join(dir, "DIGEST.md"), "# Digest\n\nAll quiet.\n");
  upgradeMemoryFrom040(kit.memory, [coordinatorId]);
  const files = kit.memory.of(coordinatorId).list();
  assert.deepEqual([...files].sort(), ["CREW.md", "GOAL.md", "MEMORY.md", "NOTES.md", "RULES.md"]);
  const notes = readFileSync(join(dir, "NOTES.md"), "utf8");
  assert.match(notes, /1\. Inventory the endpoints/);

  const gone = {
    "PLAN.md": "PLAN.md is now NOTES.md: use NOTES.md instead.",
    "PREFERENCES.md": "PREFERENCES.md is now RULES.md: use RULES.md instead.",
    "DIGEST.md": "DIGEST.md is retired: your reply to the user is the summary.",
  };
  for (const [file, refusal] of Object.entries(gone)) {
    const read = await kit.call("crew_memory_read", { file }, threadId);
    const written = await kit.call("crew_memory_write", { file, content: "# Plan\n\n1. Retry\n", baseVersion: null }, threadId);
    assert.ok(isRefusal(read) && isRefusal(written), file);
    assert.equal(textOf(read), refusal);
    assert.equal(textOf(written), refusal);
  }

  assert.deepEqual(kit.memory.of(coordinatorId).list(), files);
  assert.equal(readFileSync(join(dir, "NOTES.md"), "utf8"), notes);
});

test("a 0.4 PLAN.md the upgrade left beside an existing NOTES.md still reads, and is refused on write", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const leftover = "# Plan\n\n1. Inventory the endpoints\n";
  writeFileSync(join(dir, "PLAN.md"), leftover);
  upgradeMemoryFrom040(kit.memory, [coordinatorId]);
  const files = kit.memory.of(coordinatorId).list();
  assert.deepEqual([...files].sort(), ["CREW.md", "GOAL.md", "MEMORY.md", "NOTES.md", "PLAN.md", "RULES.md"]);

  const read = await kit.call("crew_memory_read", { file: "PLAN.md" }, threadId);
  assert.ok(!isRefusal(read));
  assert.match(textOf(read), /1\. Inventory the endpoints/);
  const written = await kit.call("crew_memory_write", { file: "PLAN.md", content: "# Plan\n\n1. Retry\n", baseVersion: null }, threadId);
  assert.ok(isRefusal(written));
  assert.equal(textOf(written), "PLAN.md is now NOTES.md: use NOTES.md instead.");

  assert.deepEqual(kit.memory.of(coordinatorId).list(), files);
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), leftover);
});

test("crew_memory_write and the editor's save reject a name outside the memory folder or not markdown", async () => {
  const { kit, threadId, coordinatorId } = await started();

  for (const file of ["../x.md", "/etc/x.md", "notes.txt", "notes/../../data.md"]) {
    await assert.rejects(kit.call("crew_memory_write", { file, content: "x", baseVersion: null }, threadId), /memory file is a \.md path inside the memory folder/, file);
    assert.equal(coordinatorContract.memoryWrite.input.safeParse({ coordinatorId, file, content: "x", baseVersion: null }).success, false, file);
  }
});

test("the Memory editor's reads and writes refuse a coordinating thread that was never started", async () => {
  const { kit } = await started();
  const unknown = { coordinatorId: coordinatorIdSchema.parse("00000000-0000-4000-8000-000000000000") };

  assert.throws(() => kit.rpc.memoryList(unknown), /no started regional manager/);
  assert.throws(() => kit.rpc.memoryWrite({ ...unknown, file: NOTES, content: "x", baseVersion: null }), /no started regional manager/);
});

test("a catch-up past its budget names the files it left out", async () => {
  const { kit, threadId, dir } = await started();
  writeFileSync(join(dir, "NOTES.md"), "x".repeat(45_000));

  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(text, /## GOAL\.md/);
  assert.doesNotMatch(text, /## NOTES\.md/);
  assert.match(text, /Not shown, to keep this short: NOTES\.md\./);
});

test("crew_end_turn repeats the manager's reason and says its turn is over, and leaves the thread running, unstopped and unmessaged", async () => {
  const { kit, threadId } = await started();
  const reason = "BBP-4's CI passed; its agent is still shipping it";
  const sent = kit.sent().length;

  const result = await kit.call("crew_end_turn", { reason }, threadId);

  assert.ok(!isRefusal(result));
  assert.equal(textOf(result), `${reason}\n\nYour turn is over. Write nothing more: no text, no whitespace and no other tool call.`);
  // why active: the manager calls it mid-turn, and a stop would leave the thread idle.
  assert.equal(kit.thread(threadId).status, "active");
  assert.equal(kit.sent().length, sent);
});

test("crew_end_turn is the regional manager's alone: an agent and a verifier are refused it", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId);
  await kit.call("agent_handoff", { status: "done", summary: "Did it", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const verdict = kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a1"))?.check?.verdict;
  const verifierThreadId = verdict?.state === "running" ? verdict.verifierThreadId : assert.fail("no verifier running");

  for (const thread of [agentThreadId, verifierThreadId]) {
    assert.ok(!kit.configurationFor(thread, {}).tools.includes("crew_end_turn"), `${thread} is not offered it`);
    const result = await kit.call("crew_end_turn", { reason: "Nothing new" }, thread);
    assert.ok(isRefusal(result), thread);
    assert.match(textOf(result), /crew_end_turn is refused: only a regional manager can use it/);
  }
});

test("the plugin loads in the SDK's fake host, which checks every tool's parameters as bb does", () => {
  const { bb, harness: host } = createFakePluginHost();
  plugin(bb);
  assert.deepEqual(
    new Set(host.registrations.agentTools.map(({ name }) => name)),
    new Set(["crew_catch_up", "crew_memory_read", "crew_memory_write", "crew_remind", "crew_ask_user", "crew_end_turn", "issue_create", "issue_update", "issue_read", "agent_start", "agent_message", "agent_stop", "agent_handoff", "issue_review", "issue_verdict"]),
  );
});

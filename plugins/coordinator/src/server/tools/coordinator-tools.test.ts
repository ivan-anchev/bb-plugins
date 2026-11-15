import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { coordinatorContract } from "../../contract.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { harness, isRefusal, newThreadRequest, textOf } from "../test-harness.ts";

const PLAN = memoryFileSchema.parse("PLAN.md");

async function started() {
  const kit = harness();
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));
  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  return { kit, threadId, coordinatorId: role.coordinatorId, dir: kit.memory.of(role.coordinatorId).dir };
}

/** The version a catch-up shows for a file, as the agent would read it off. */
const versionIn = (text: string, file: string): string | undefined => new RegExp(`^## ${file.replace(".", "\\.")} \\(version (\\w+)\\)$`, "m").exec(text)?.[1];

test("a file written with crew_memory_write is in the next catch-up and in the Memory editor's reads", async () => {
  const { kit, threadId, coordinatorId } = await started();
  const before = textOf(await kit.call("crew_catch_up", {}, threadId));

  const plan = "# Plan\n\n1. Inventory the endpoints\n";
  assert.match(textOf(await kit.call("crew_memory_write", { file: "PLAN.md", content: plan, baseVersion: versionIn(before, "PLAN.md") }, threadId)), /^Saved PLAN\.md, now version \w+\.$/);
  assert.equal(textOf(await kit.call("crew_memory_write", { file: "notes/api.md", content: "# API\n", baseVersion: null }, threadId)), `Saved notes/api.md, now version ${kit.memory.of(coordinatorId).read(memoryFileSchema.parse("notes/api.md")).text?.version}.`);

  const after = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(after, /## PLAN\.md \(version \w+\)\n\n# Plan\n\n1\. Inventory the endpoints/);
  assert.match(after, /Other memory files, read each with crew_memory_read: notes\/api\.md\./);

  assert.deepEqual((await kit.rpc.memoryList({ coordinatorId })).files.slice(-2), ["DIGEST.md", "notes/api.md"]);
  assert.equal((await kit.rpc.memoryRead({ coordinatorId, file: PLAN })).text?.content, plan);
  assert.deepEqual(kit.memoryWrites().slice(-2), [coordinatorId, coordinatorId], "each write refreshes the editor");
});

test("a Coordinator write from before the user's save is refused with the user's text, and its merge then saves", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const read = versionIn(textOf(await kit.call("crew_catch_up", {}, threadId)), "PLAN.md");
  const userRead = (await kit.rpc.memoryRead({ coordinatorId, file: PLAN })).text;
  assert.equal(userRead?.version, read);
  const saved = await kit.rpc.memoryWrite({ coordinatorId, file: PLAN, content: "# Plan\n\n1. The user's step\n", baseVersion: read ?? null });
  assert.equal(saved.outcome, "saved");

  const refused = await kit.call("crew_memory_write", { file: "PLAN.md", content: "# Plan\n\n1. The Coordinator's step\n", baseVersion: read }, threadId);
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /changed since you read it/);
  assert.match(textOf(refused), /## PLAN\.md \(version \w+\)\n\n# Plan\n\n1\. The user's step/);
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), "# Plan\n\n1. The user's step\n");

  const merged = "# Plan\n\n1. The user's step\n2. The Coordinator's step\n";
  assert.ok(!isRefusal(await kit.call("crew_memory_write", { file: "PLAN.md", content: merged, baseVersion: versionIn(textOf(refused), "PLAN.md") }, threadId)));
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), merged);
});

test("the editor's save from a stale read is refused too, and the Coordinator's text is kept", async () => {
  const { kit, threadId, coordinatorId, dir } = await started();
  const userRead = (await kit.rpc.memoryRead({ coordinatorId, file: PLAN })).text;
  await kit.call("crew_memory_write", { file: "PLAN.md", content: "# Plan\n\nThe Coordinator's plan\n", baseVersion: userRead?.version ?? null }, threadId);

  const outcome = await kit.rpc.memoryWrite({ coordinatorId, file: PLAN, content: "# Plan\n\nThe user's plan\n", baseVersion: userRead?.version ?? null });
  assert.equal(outcome.outcome, "conflict");
  assert.equal(outcome.outcome === "conflict" ? outcome.current.text?.content : undefined, "# Plan\n\nThe Coordinator's plan\n");
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), "# Plan\n\nThe Coordinator's plan\n");
});

test("crew_memory_write from a thread that is not a Coordinator is refused and writes nothing", async () => {
  const { kit, coordinatorId, dir } = await started();
  const plan = readFileSync(join(dir, "PLAN.md"), "utf8");

  for (const file of ["PLAN.md", "notes/api.md"]) {
    const result = await kit.call("crew_memory_write", { file, content: "# Taken over\n", baseVersion: null }, "thr_forged");
    assert.ok(isRefusal(result));
    assert.match(textOf(result), /crew_memory_write is refused/);
  }
  assert.equal(readFileSync(join(dir, "PLAN.md"), "utf8"), plan);
  assert.deepEqual(kit.memory.of(coordinatorId).list(), ["MEMORY.md", "GOAL.md", "PLAN.md", "PREFERENCES.md", "CREW.md", "DIGEST.md"]);
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

  assert.throws(() => kit.rpc.memoryList(unknown), /no coordinating thread/);
  assert.throws(() => kit.rpc.memoryWrite({ ...unknown, file: PLAN, content: "x", baseVersion: null }), /no coordinating thread/);
});

test("a catch-up past its budget names the files it left out", async () => {
  const { kit, threadId, dir } = await started();
  writeFileSync(join(dir, "PLAN.md"), "x".repeat(45_000));

  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(text, /## GOAL\.md/);
  assert.doesNotMatch(text, /## PLAN\.md/);
  assert.match(text, /Not shown, to keep this short: PLAN\.md\./);
});

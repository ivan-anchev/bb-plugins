import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { harness, isRefusal, newThreadRequest, textOf } from "../test-harness.ts";

const RETRIES = { title: "Add retries", brief: "Retry failed webhook deliveries with backoff.", doneCriteria: ["npm test passes", "a failed delivery is retried 3 times"] };

async function coordinating(...args: Parameters<typeof harness>) {
  const kit = harness(...args);
  const { threadId } = await kit.spawner.coordinator(newThreadRequest("Migrate the webhook service"));
  const role = kit.store.roleOfThread(threadId);
  assert.equal(role?.kind, "coordinator");
  return { kit, threadId, coordinatorId: role.coordinatorId };
}

const threadIn = (text: string): string => /@thread:(\w+)/.exec(text)?.[1] ?? assert.fail(`no thread link in: ${text}`);

test("crew_start starts a child of the Coordinator in a fresh worktree, unreported to it, and links it", async () => {
  const { kit, threadId } = await coordinating();
  const result = textOf(await kit.call("crew_start", RETRIES, threadId));
  assert.match(result, /^Started c1 as @thread:\w+\./);

  const { spawnedWith } = kit.thread(threadIn(result));
  assert.equal(spawnedWith.parentThreadId, threadId);
  assert.equal(spawnedWith.lifecycleOwnerThreadId, threadId);
  assert.equal(spawnedWith.parentNotifications, "off");
  assert.deepEqual(spawnedWith.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
});

test("a crew's first message holds the brief, every done-criterion, and CREW.md and MEMORY.md whole", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const memory = kit.memory.of(coordinatorId);
  const crewMd = memoryFileSchema.parse("CREW.md");
  const background = "Background the crew should know.\n".repeat(1_000);
  memory.write(crewMd, `# Crew rules\n\nOpen a draft PR for every change.\n\n${background}\nNever push to main.\n`, memory.read(crewMd).text?.version ?? null);

  const { spawnedWith } = kit.thread(threadIn(textOf(await kit.call("crew_start", RETRIES, threadId))));
  const prompt = spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /Retry failed webhook deliveries with backoff\./);
  assert.match(prompt, /1\. npm test passes\n2\. a failed delivery is retried 3 times/);
  assert.match(prompt, /## CREW\.md[^\n]*\n\n# Crew rules\n\nOpen a draft PR for every change\./);
  assert.ok(prompt.indexOf("Never push to main.") > prompt.indexOf("# Crew rules") + 20_000, "the last CREW.md rule is missing or not past 20,000 characters");
  assert.match(prompt, /## MEMORY\.md[^\n]*\n\n# Memory\n\nThe index of this memory/);
  assert.match(prompt, /You are crew c1/);
});

test("crew_start is rejected without done-criteria, with none, or with more than 12", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { doneCriteria: _, ...withoutCriteria } = RETRIES;
  for (const input of [withoutCriteria, { ...RETRIES, doneCriteria: [] }, { ...RETRIES, doneCriteria: [" "] }, { ...RETRIES, doneCriteria: Array.from({ length: 13 }, (_, i) => `criterion ${i}`) }]) {
    await assert.rejects(kit.call("crew_start", input, threadId));
  }
  assert.deepEqual(kit.store.crews(coordinatorId), []);
});

test("a provider placement spawns in that environment provider", async () => {
  const { kit, threadId } = await coordinating();
  const result = textOf(await kit.call("crew_start", { ...RETRIES, placement: { kind: "provider", environmentProviderId: "boat-sandbox" } }, threadId));
  assert.deepEqual(kit.thread(threadIn(result)).spawnedWith.environment, { type: "provider", environmentProviderId: "boat-sandbox", inputs: null });
});

test("crews are numbered in the order started, per Coordinator", async () => {
  const { kit, threadId } = await coordinating();
  assert.match(textOf(await kit.call("crew_start", RETRIES, threadId)), /^Started c1 /);
  assert.match(textOf(await kit.call("crew_start", { ...RETRIES, title: "Dead letters" }, threadId)), /^Started c2 /);
  const other = await kit.spawner.coordinator(newThreadRequest("Retire the cron box"));
  assert.match(textOf(await kit.call("crew_start", RETRIES, other.threadId)), /^Started c1 /);
});

test("a crew whose spawn failed is kept and says so; one whose answer alone was lost is started", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  Object.assign(kit.spawns, { created: false, answer: "lost" });
  assert.match(textOf(await kit.call("crew_start", RETRIES, threadId)), /^c1 was saved, but bb did not start its thread: socket hang up\./);

  Object.assign(kit.spawns, { created: true, answer: "lost" });
  assert.match(textOf(await kit.call("crew_start", RETRIES, threadId)), /^Started c2 as @thread:\w+\./);

  assert.deepEqual((await kit.rpc.board({ coordinatorId })).rows.map((row) => [row.crewId, row.state, row.headline]), [
    ["c1", "needs-you", "Not started: bb never confirmed its thread"],
    ["c2", "working", "Working"],
  ]);
});

test("crew_message reaches the crew as a message from the Coordinator's thread", async () => {
  const { kit, threadId } = await coordinating();
  const crewThreadId = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));

  assert.equal(textOf(await kit.call("crew_message", { crewId: "c1", text: "Use exponential backoff." }, threadId)), "Sent to c1.");
  assert.deepEqual(kit.sent().map(({ threadId: to, senderThreadId, mode, input }) => ({ to, senderThreadId, mode, input })), [
    { to: crewThreadId, senderThreadId: threadId, mode: "auto", input: [{ type: "text", text: "Use exponential backoff.", mentions: [] }] },
  ]);
});

test("a crew id the Coordinator has no crew by is refused, and a crew can't be reached from another Coordinator", async () => {
  const { kit, threadId } = await coordinating();
  await kit.call("crew_start", RETRIES, threadId);
  const other = await kit.spawner.coordinator(newThreadRequest("Retire the cron box"));

  for (const caller of [threadId, other.threadId]) {
    const crewId = caller === threadId ? "c2" : "c1";
    const result = await kit.call("crew_message", { crewId, text: "Hello" }, caller);
    assert.ok(isRefusal(result));
    assert.match(textOf(result), new RegExp(`You have no crew ${crewId}`));
  }
  assert.deepEqual(kit.sent(), []);
});

test("the board puts a running crew under Working, one waiting on an approval under Needs you, and a stopped one under Done", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const ids = [];
  for (const title of ["Running", "Asking", "Stopped"]) ids.push(threadIn(textOf(await kit.call("crew_start", { ...RETRIES, title }, threadId))));
  kit.thread(ids[1] ?? "").hasPendingInteraction = true;
  assert.equal(textOf(await kit.call("crew_close", { crewId: "c3", action: "stop" }, threadId)), "c3 is stopped. It shows under Done.");

  const { rows } = await kit.rpc.board({ coordinatorId });
  assert.deepEqual(rows.map((row) => [row.crewId, row.state, row.threadId, row.branch]), [
    ["c1", "working", ids[0], `bb/${ids[0]}`],
    ["c2", "needs-you", ids[1], `bb/${ids[1]}`],
    ["c3", "done", ids[2], `bb/${ids[2]}`],
  ]);
});

test("crew_catch_up shows the board grouped by state, above the memory", async () => {
  const { kit, threadId } = await coordinating();
  const crewThreadId = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));
  kit.thread(crewThreadId).status = "idle";

  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(text, new RegExp(`^## Board\\n\\n### Idle \\(1\\)\\n- c1 "Add retries", @thread:${crewThreadId} on branch \`bb/${crewThreadId}\`: Its turn ended`));
  assert.ok(text.indexOf("## Board") < text.indexOf("## MEMORY.md"));
});

test("crew_close stop is recorded only once bb no longer runs the thread", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ created: true, answer: "thread" }, "stopping");
  await kit.call("crew_start", RETRIES, threadId);

  assert.match(textOf(await kit.call("crew_close", { crewId: "c1", action: "stop" }, threadId)), /still stopping, so it is not recorded as stopped/);
  assert.equal(kit.store.crews(coordinatorId)[0]?.closed, null);
});

test("crew_close archive archives the thread, and resolve leaves it; both move the crew to Done", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const archived = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));
  const resolved = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));

  await kit.call("crew_close", { crewId: "c1", action: "archive" }, threadId);
  await kit.call("crew_close", { crewId: "c2", action: "resolve" }, threadId);
  assert.notEqual(kit.thread(archived).archivedAt, null);
  assert.equal(kit.thread(resolved).archivedAt, null);
  assert.deepEqual((await kit.rpc.board({ coordinatorId })).rows.map((row) => [row.state, row.headline]), [["done", "Archived"], ["done", "Resolved"]]);
  assert.match(textOf(await kit.call("crew_message", { crewId: "c2", text: "More" }, threadId)), /c2 is resolved, so it takes no more messages/);
});

test("crew_read returns the crew's state, brief, criteria and latest answer", async () => {
  const { kit, threadId } = await coordinating();
  await kit.call("crew_start", RETRIES, threadId);

  const text = textOf(await kit.call("crew_read", { crewId: "c1" }, threadId));
  assert.match(text, /^## c1: Add retries\n\nWorking: Working\. Thread: @thread:\w+, branch `bb\/\w+`\./);
  assert.match(text, /### Done when\n\n1\. npm test passes\n2\. a failed delivery is retried 3 times/);
  assert.match(text, /### Its latest answer\n\nDone: npm test passes\./);
});

test("a crew thread's status change refreshes its Coordinator's board, and no other's", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const crewThreadId = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));
  const before = kit.invalidated().length;

  kit.announce("thread.idle", crewThreadId);
  kit.announce("experimental_thread.events", crewThreadId);
  kit.announce("thread.idle", threadId);
  assert.deepEqual(kit.invalidated().slice(before), [`board:${coordinatorId}`, `board:${coordinatorId}`]);
});

test("a crew whose thread was archived or deleted outside the plugin is Done", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const archived = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));
  const deleted = threadIn(textOf(await kit.call("crew_start", RETRIES, threadId)));
  kit.thread(archived).archivedAt = 5_000; // as archiving the coordinating thread does to its crew
  kit.thread(deleted).deletedAt = 5_000;

  assert.deepEqual((await kit.rpc.board({ coordinatorId })).rows.map((row) => [row.crewId, row.state, row.headline, row.branch]), [
    ["c1", "done", "Its thread was archived or deleted", null],
    ["c2", "done", "Its thread was archived or deleted", null],
  ]);
});

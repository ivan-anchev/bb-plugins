import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import plugin from "../../../server.ts";
import { COORDINATORS_TAG, coordinatorContract as contract } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import { memoryStorage } from "../memory-storage.ts";
import { heldAs030 } from "../store/test-store.ts";
import { harness, newThreadRequest, settled } from "../test-harness.ts";
import { PLACEHOLDER } from "./held-managers.ts";

// A regional manager's record through the RPC the panel calls, as server.ts registers it: created
// with its profile and no thread, started by the goal sent from its page, edited before and after,
// and deleted while it has no thread.

const PROFILE: Profile = { name: "Webhooks", description: "Moves the webhook service off the cron box.", avatar: { kind: "icon", icon: "Zap" } };
const GOAL = "Migrate the webhook service";

const goalFile = (kit: ReturnType<typeof harness>, id: CoordinatorId) => join(kit.memory.of(id).dir, "GOAL.md");

/** A regional manager created through the RPC with PROFILE, as server.ts wires it. */
async function created() {
  const kit = harness();
  const coordinatorId = coordinatorIdSchema.parse((await kit.rpc.createCoordinator({ profile: PROFILE })).coordinatorId);
  const listed = async () => ({ coordinators: kit.store.coordinators(), notStarted: kit.store.notStarted() });
  const start = async (goal = GOAL) => (await kit.rpc.startCoordinator({ coordinatorId, request: newThreadRequest(goal) })).threadId;
  const setProfile = async (profile: Profile, id = coordinatorId) => kit.rpc.setProfile({ coordinatorId: id, profile });
  return { kit, coordinatorId, listed, start, setProfile };
}

test("server.ts registers the record's RPC: Create spawns nothing, and the goal starts the regional manager in a thread titled with its name", async () => {
  const kit = harness();
  const loaded = kit.load(plugin);
  const { coordinatorId } = contract.createCoordinator.output.parse(await loaded.callRpc("createCoordinator", { profile: PROFILE }));
  assert.equal(kit.spawned(), 0);
  assert.deepEqual(contract.coordinators.output.parse(await loaded.callRpc("coordinators", {})), { coordinators: [], notStarted: [{ id: coordinatorId, ...PROFILE }] });

  const { threadId } = contract.startCoordinator.output.parse(await loaded.callRpc("startCoordinator", { coordinatorId, request: newThreadRequest(GOAL) }));
  assert.equal(kit.thread(threadId).title, "Webhooks");
  assert.deepEqual(loaded.experimental_rpcInvalidations.filter((tags) => tags?.includes(COORDINATORS_TAG)).length, 2, "the create and the bind each refresh the list");
});

test("its goal starts it: one thread, titled with its name, the goal its first message and its GOAL.md, on what the composer picked; it is then listed as started", async () => {
  const { kit, coordinatorId, listed, start } = await created();

  const threadId = await start();

  const thread = kit.thread(threadId);
  assert.deepEqual([thread.title, thread.spawnedWith.input, thread.spawnedWith.environment], ["Webhooks", newThreadRequest(GOAL).input, newThreadRequest(GOAL).environment]);
  assert.equal(readFileSync(goalFile(kit, coordinatorId), "utf8"), GOAL);
  const { coordinators, notStarted } = await listed();
  assert.deepEqual([coordinators.map((c) => [c.id, c.threadId, c.projectId, c.description]), notStarted], [[[coordinatorId, threadId, "prj_1", PROFILE.description]], []]);
});

test("a goal sent twice at once, or again once started, spawns one thread, and every send answers with it", async () => {
  const { kit, start } = await created();

  const [first, second] = await Promise.all([start(), start()]);
  const again = await start("Something else");

  assert.equal(kit.spawned(), 1);
  assert.deepEqual([second, again], [first, first]);
});

test("a start bb refuses before it makes a thread leaves the regional manager not started, and its goal sent again starts it, GOAL.md the later goal", async () => {
  const { kit, coordinatorId, start } = await created();
  kit.spawns.answer = "refused";
  await assert.rejects(start("First try"), /Invalid environment/);
  assert.equal(kit.store.startOf(coordinatorId)?.kind, "not-started");

  kit.spawns.answer = "thread";
  const threadId = await start("Second try");

  assert.deepEqual([kit.spawned(), kit.store.coordinator(coordinatorId)?.threadId], [1, threadId]);
  assert.equal(readFileSync(goalFile(kit, coordinatorId), "utf8"), "Second try");
});

test("a start whose thread bb made, but whose answer and thread.created were both lost, is answered by its goal sent again with that thread: no second thread, GOAL.md the first goal, one role", async () => {
  const { kit, coordinatorId, start } = await created();
  kit.spawns.answer = "lost";
  kit.spawns.created = false;
  await assert.rejects(start("First try"), /socket hang up/);
  assert.equal(kit.store.roleOfThread("thr_1"), null, "nothing bound the thread");

  kit.spawns.answer = "thread";
  const threadId = await start("Second try");

  assert.deepEqual([threadId, kit.spawned(), kit.store.coordinator(coordinatorId)?.threadId], ["thr_1", 1, "thr_1"]);
  assert.deepEqual(kit.store.roleOfThread("thr_1"), { kind: "coordinator", coordinatorId });
  assert.equal(readFileSync(goalFile(kit, coordinatorId), "utf8"), "First try");
});

test("a start whose lost thread the user archived before sending the goal again spawns a new one", async () => {
  const { kit, coordinatorId, start } = await created();
  kit.spawns.answer = "lost";
  kit.spawns.created = false;
  await assert.rejects(start("First try"), /socket hang up/);
  kit.thread("thr_1").archivedAt = 5_000;
  kit.spawns.answer = "thread";
  const threadId = await start("Second try");
  assert.deepEqual([threadId, kit.spawned(), kit.store.coordinator(coordinatorId)?.threadId], ["thr_2", 2, "thr_2"]);
});

test("a start the composer's contract doesn't allow is refused before it runs: no project, no memory, no thread", async () => {
  const kit = harness();
  const loaded = kit.load(plugin);
  const { coordinatorId } = contract.createCoordinator.output.parse(await loaded.callRpc("createCoordinator", { profile: PROFILE }));
  const { environment: _, ...placeless } = newThreadRequest(GOAL);

  for (const request of [placeless, { ...newThreadRequest(GOAL), input: [] }, { ...newThreadRequest(GOAL), providerId: 7 }]) {
    await assert.rejects(loaded.callRpc("startCoordinator", { coordinatorId, request }), { code: "invalid_input" }, JSON.stringify(request));
  }

  assert.equal(kit.spawned(), 0);
  assert.deepEqual(contract.coordinators.output.parse(await loaded.callRpc("coordinators", {})).notStarted.map(({ id }) => id), [coordinatorId]);
});

test("a start passes on only the composer's fields: one bb would take from another caller, such as visibility, never reaches the spawn", async () => {
  const kit = harness();
  const loaded = kit.load(plugin);
  const { coordinatorId } = contract.createCoordinator.output.parse(await loaded.callRpc("createCoordinator", { profile: PROFILE }));

  const { threadId } = contract.startCoordinator.output.parse(await loaded.callRpc("startCoordinator", { coordinatorId, request: { ...newThreadRequest(GOAL), executionInputSources: { permissionMode: "explicit" }, visibility: "hidden" } }));

  assert.equal("visibility" in kit.thread(threadId).spawnedWith, false);
  assert.equal("executionInputSources" in kit.thread(threadId).spawnedWith, false);
});

test("an edit before the start renames no thread and keeps the whole profile; the start then titles the thread with the new name", async () => {
  const { kit, listed, start, setProfile } = await created();
  const edited: Profile = { name: "Scout", description: null, avatar: { kind: "icon", icon: "Brain" } };
  const before = kit.invalidated().length;

  assert.deepEqual(await setProfile(edited), {});

  assert.deepEqual(kit.threadUpdates.asked, []);
  assert.deepEqual((await listed()).notStarted.map(({ name, description, avatar }) => ({ name, description, avatar })), [edited]);
  assert.deepEqual(kit.invalidated().slice(before), [COORDINATORS_TAG]);
  assert.equal(kit.thread(await start()).title, "Scout");
});

test("an edit after the start retitles the thread in bb and replaces the description and avatar the list reads", async () => {
  const { kit, listed, start, setProfile } = await created();
  const threadId = await start();
  const edited: Profile = { name: "Webhooks v2", description: null, avatar: { kind: "icon", icon: "Brain" } };

  assert.deepEqual(await setProfile(edited), {});

  assert.equal(kit.thread(threadId).title, "Webhooks v2");
  const [coordinator] = (await listed()).coordinators;
  assert.deepEqual([coordinator?.description, coordinator?.avatar], [null, edited.avatar]);
});

test("an edit or a start of a regional manager that doesn't exist is refused as not found, and renames and spawns nothing", async () => {
  const { kit, setProfile } = await created();
  const missing = coordinatorIdSchema.parse("0d3b8f5e-1c2a-4e6f-8a9b-7c5d3e1f2a40");

  await assert.rejects(setProfile(PROFILE, missing), { code: "not_found" });
  await assert.rejects(async () => kit.rpc.startCoordinator({ coordinatorId: missing, request: newThreadRequest(GOAL) }), { code: "not_found" });
  assert.deepEqual([kit.threadUpdates.asked, kit.spawned()], [[], 0]);
});

test("an edit bb refuses to rename writes nothing of the profile", async () => {
  const { kit, listed, start, setProfile } = await created();
  const threadId = await start();
  kit.thread(threadId).deletedAt = 5_000;

  await assert.rejects(setProfile({ name: "Gone", description: "Never kept", avatar: { kind: "icon", icon: "Bug" } }));
  const [coordinator] = (await listed()).coordinators;
  assert.deepEqual([coordinator?.description, coordinator?.avatar], [PROFILE.description, PROFILE.avatar]);
});

test("two edits at once land one after the other, so the profile is the later one whole", async () => {
  const { kit, listed, start, setProfile } = await created();
  const threadId = await start();
  const first: Profile = { name: "First", description: "First", avatar: { kind: "icon", icon: "Bug" } };
  const second: Profile = { name: "Second", description: "Second", avatar: { kind: "icon", icon: "Star" } };
  kit.threadUpdates.holding = true;

  const both = Promise.all([setProfile(first), setProfile(second)]);
  await settled();
  assert.deepEqual(kit.threadUpdates.asked, ["First"], "the second edit waits for the first");
  kit.threadUpdates.holding = false;
  kit.threadUpdates.held.splice(0).forEach((release) => release());
  await both;

  assert.equal(kit.thread(threadId).title, "Second");
  const [coordinator] = (await listed()).coordinators;
  assert.deepEqual([coordinator?.description, coordinator?.avatar], [second.description, second.avatar]);
});

test("Delete removes a regional manager not started yet, and refuses one with a thread, which bb archives or deletes", async () => {
  const { kit, coordinatorId, listed } = await created();
  const { coordinatorId: other, threadId } = await kit.startManager("Cron");

  assert.deepEqual(await kit.rpc.deleteCoordinator({ coordinatorId }), {});
  await assert.rejects(async () => kit.rpc.deleteCoordinator({ coordinatorId: other }), { code: "conflict" });

  assert.deepEqual((await listed()).notStarted, []);
  assert.equal(kit.store.startOf(coordinatorId), null);
  assert.equal(kit.store.coordinator(other)?.threadId, threadId);
});

/** A harness over its own database, holding "Janitor" as 0.3.0 left it: its thread `status`, flagged unless not `flagged`, no GOAL.md. */
async function as030(status: "pending" | "idle", { flagged = true } = {}) {
  const { storage } = memoryStorage();
  const kit = harness(undefined, undefined, storage);
  const { coordinatorId, threadId } = await kit.startManager("Janitor");
  heldAs030(storage, coordinatorId, flagged);
  rmSync(goalFile(kit, coordinatorId));
  kit.thread(threadId).status = status;
  return { kit, coordinatorId, threadId };
}

test("a 0.3.0 regional manager whose only user message is the placeholder, run or held, flag set or cleared, becomes one not started yet: queue emptied, thread archived without the role; its goal then starts a new thread", async () => {
  for (const [status, flagged] of [["idle", true], ["idle", false], ["pending", true]] as const) {
    const { kit, coordinatorId, threadId: held } = await as030(status, { flagged });
    if (status === "idle") kit.turnRequested(held, PLACEHOLDER);
    kit.heldPlaceholder(held);

    await kit.upgrade030();

    assert.deepEqual([kit.queued(held), kit.thread(held).archivedAt !== null, kit.store.roleOfThread(held)], [[], true, null]);
    assert.deepEqual(kit.store.notStarted().map(({ id, name }) => [id, name]), [[coordinatorId, "Janitor"]]);
    assert.deepEqual([kit.store.coordinators(), existsSync(goalFile(kit, coordinatorId)), kit.sendAttempts(), kit.warnings()], [[], false, [], []]);
    const { threadId } = await kit.rpc.startCoordinator({ coordinatorId, request: newThreadRequest(GOAL) });
    assert.deepEqual([threadId === held, kit.thread(threadId).title, readFileSync(goalFile(kit, coordinatorId), "utf8")], [false, "Janitor", GOAL]);
  }
});

test("a 0.3.0 regional manager that had a real message from the user keeps its thread and role, its queued placeholder taken out; a missing GOAL.md becomes that first message, one that exists stays", async () => {
  for (const kept of [null, "The goal as 0.3.0 wrote it"]) {
    const { kit, coordinatorId, threadId } = await as030("idle");
    if (kept !== null) writeFileSync(goalFile(kit, coordinatorId), kept);
    kit.turnRequested(threadId, PLACEHOLDER, "plugin");
    kit.turnRequested(threadId, "Tidy the repo's stale branches");
    kit.turnRequested(threadId, "And its labels");
    kit.heldPlaceholder(threadId);

    await kit.upgrade030();

    assert.deepEqual([kit.queued(threadId), kit.thread(threadId).archivedAt, kit.store.coordinator(coordinatorId)?.threadId], [[], null, threadId]);
    assert.equal(readFileSync(goalFile(kit, coordinatorId), "utf8"), kept ?? "Tidy the repo's stale branches");
    assert.deepEqual(kit.store.upgradeCandidates().map(({ flagged }) => flagged), [false]);
  }
});

test("the upgrade leaves a regional manager this release started as it is, even with no GOAL.md", async () => {
  const kit = harness();
  const { coordinatorId, threadId } = await kit.startManager("Current");
  rmSync(goalFile(kit, coordinatorId));
  kit.turnRequested(threadId, "Current", "plugin");

  await kit.upgrade030();

  assert.deepEqual([kit.store.coordinator(coordinatorId)?.threadId, kit.thread(threadId).archivedAt, existsSync(goalFile(kit, coordinatorId))], [threadId, null, false]);
});

test("a 0.3.0 regional manager whose spawn never bound a thread becomes one not started yet, so it can be started or deleted", async () => {
  const { storage } = memoryStorage();
  const kit = harness(undefined, undefined, storage);
  const coordinatorId = await kit.createManager("Unbound");
  heldAs030(storage, coordinatorId);
  assert.equal(kit.store.startOf(coordinatorId), null, "before the upgrade it is neither started nor not started");

  await kit.upgrade030();

  assert.deepEqual(kit.store.notStarted().map(({ id, name }) => [id, name]), [[coordinatorId, "Regional manager"]]);
  assert.deepEqual(await kit.rpc.deleteCoordinator({ coordinatorId }), {});
});

test("an upgrade bb fails is tried again by the next call, as the next tick makes it, and one that went through is never run again", async () => {
  const { kit, coordinatorId, threadId: held } = await as030("pending");
  kit.heldPlaceholder(held);
  kit.queueReads.failure = new Error("bb is restarting");

  await kit.upgrade030();
  assert.equal(kit.store.coordinator(coordinatorId)?.threadId, held, "it waits as it was");
  assert.match(kit.warnings().join("\n"), /bb is restarting/);

  kit.queueReads.failure = null;
  await kit.upgrade030();
  assert.deepEqual([kit.thread(held).archivedAt !== null, kit.store.notStarted().map(({ id }) => id)], [true, [coordinatorId]]);

  kit.queueReads.failure = new Error("never read");
  const warned = kit.warnings().length;
  await kit.upgrade030();
  assert.equal(kit.warnings().length, warned, "a pass that went through leaves nothing to run");
});

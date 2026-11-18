import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "../../../server.ts";
import { COORDINATORS_TAG, coordinatorContract as contract } from "../../contract.ts";
import type { Profile } from "../../model/profile.ts";
import { coordinatorStart, harness, settled } from "../test-harness.ts";

// A regional manager's profile through the RPC the panel calls, as server.ts registers it: its
// name is its thread's title in bb, and the plugin keeps its description and avatar.

const PROFILE: Profile = { name: "Webhooks", description: "Moves the webhook service off the cron box.", avatar: { kind: "icon", icon: "Zap" } };

/** server.ts loaded over the fake bb, and a regional manager started through its RPC with PROFILE. */
async function started() {
  const kit = harness();
  const loaded = kit.load(plugin);
  const { threadId } = contract.startCoordinator.output.parse(await loaded.callRpc("startCoordinator", { ...coordinatorStart("Migrate the webhook service"), profile: PROFILE }));
  const listed = async () => contract.coordinators.output.parse(await loaded.callRpc("coordinators", {})).coordinators;
  const [coordinator] = await listed();
  assert.ok(coordinator !== undefined);
  return { kit, loaded, threadId, coordinatorId: coordinator.id, listed };
}

test("a regional manager starts with its profile: its thread is titled with the name, and the list reads its description and avatar", async () => {
  const { kit, threadId, listed } = await started();

  assert.equal(kit.thread(threadId).title, "Webhooks");
  const [coordinator] = await listed();
  assert.deepEqual([coordinator?.threadId, coordinator?.description, coordinator?.avatar], [threadId, PROFILE.description, PROFILE.avatar]);
});

test("an edit retitles the thread in bb and replaces the description and avatar the list reads, and the list is read again", async () => {
  const { kit, loaded, threadId, coordinatorId, listed } = await started();
  const edited: Profile = { name: "Webhooks v2", description: null, avatar: { kind: "icon", icon: "Brain" } };
  const before = loaded.experimental_rpcInvalidations.length;

  assert.deepEqual(await loaded.callRpc("setProfile", { coordinatorId, profile: edited }), {});

  assert.equal(kit.thread(threadId).title, "Webhooks v2");
  const [coordinator] = await listed();
  assert.deepEqual([coordinator?.description, coordinator?.avatar], [null, edited.avatar]);
  assert.deepEqual(loaded.experimental_rpcInvalidations.slice(before), [[COORDINATORS_TAG]]);
});

test("an edit of a regional manager that doesn't exist is refused as not found, and renames nothing", async () => {
  const { kit, loaded, threadId } = await started();

  await assert.rejects(loaded.callRpc("setProfile", { coordinatorId: "0d3b8f5e-1c2a-4e6f-8a9b-7c5d3e1f2a40", profile: PROFILE }), { code: "not_found" });
  assert.equal(kit.thread(threadId).title, "Webhooks");
});

test("an edit bb refuses to rename writes nothing of the profile", async () => {
  const { kit, loaded, threadId, coordinatorId, listed } = await started();
  kit.thread(threadId).deletedAt = 5_000;

  await assert.rejects(loaded.callRpc("setProfile", { coordinatorId, profile: { name: "Gone", description: "Never kept", avatar: { kind: "icon", icon: "Bug" } } }));
  const [coordinator] = await listed();
  assert.deepEqual([coordinator?.description, coordinator?.avatar], [PROFILE.description, PROFILE.avatar]);
});

test("two edits at once land one after the other, so the profile is the later one whole", async () => {
  const { kit, loaded, threadId, coordinatorId, listed } = await started();
  const first: Profile = { name: "First", description: "First", avatar: { kind: "icon", icon: "Bug" } };
  const second: Profile = { name: "Second", description: "Second", avatar: { kind: "icon", icon: "Star" } };
  kit.threadUpdates.holding = true;

  const both = Promise.all([loaded.callRpc("setProfile", { coordinatorId, profile: first }), loaded.callRpc("setProfile", { coordinatorId, profile: second })]);
  await settled();
  assert.deepEqual(kit.threadUpdates.asked, ["First"], "the second edit waits for the first");
  kit.threadUpdates.holding = false;
  kit.threadUpdates.held.splice(0).forEach((release) => release());
  await both;

  assert.equal(kit.thread(threadId).title, "Second");
  const [coordinator] = await listed();
  assert.deepEqual([coordinator?.description, coordinator?.avatar], [second.description, second.avatar]);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession } from "./boat/access.ts";
import { BoatApiError, type BoatClient, type CreateSandboxBody, type Labels } from "./boat/client.ts";
import { toSandbox, type Sandbox, type SandboxId } from "./boat/sandbox.ts";
import { createStartGate } from "./boat/start-gate.ts";
import { accountId, sandboxId, wireMe } from "./boat/wire.ts";
import { boatMachineProvider } from "./machine-provider.ts";
import { machineLabels } from "./ownership.ts";

const OWNER = "owner-1";
const ACCOUNT = "sandbox_account_1";
const CAPTURED = JSON.parse(readFileSync(new URL("./boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;

/** boat in memory: Idempotency-Keys and labels behave as on the live API (spike Q1, Q9). */
function fakeBoat() {
  const sandboxes = new Map<SandboxId, Sandbox>();
  const byIdempotencyKey = new Map<string, Sandbox>();
  const posts: string[] = [];
  const add = (labels: Labels): Sandbox => {
    const id = sandboxId.parse(`bx_${"abcdefghjkmnpqrs".slice(sandboxes.size, sandboxes.size + 8)}`);
    const sandbox = toSandbox({ ...CAPTURED, id, labels, state: "idle" });
    if (sandbox === null) throw new Error("unreachable: idle is present");
    sandboxes.set(id, sandbox);
    return sandbox;
  };
  const client: BoatClient = {
    me: async () => wireMe.parse({ user: { id: ACCOUNT, login: "octocat", zeroDataRetention: false } }),
    limits: async () => ({ wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null }),
    get: async (id) => sandboxes.get(id) ?? null,
    list: async (labels) =>
      [...sandboxes.values()].filter((sandbox) => Object.entries(labels).every(([key, value]) => sandbox.labels[key] === value)),
    async create(body: CreateSandboxBody, idempotencyKey: string) {
      posts.push(idempotencyKey);
      const replay = byIdempotencyKey.get(idempotencyKey);
      if (replay !== undefined) return replay;
      const created = add(body.labels);
      byIdempotencyKey.set(idempotencyKey, created);
      return created;
    },
    async remove(id) {
      if (!sandboxes.delete(id)) throw new BoatApiError(404, "not_found", "not_found", null, false);
    },
    run: async () => ({ exitCode: 0 }),
    writeFile: async () => {},
  };
  return { client, sandboxes, posts, add };
}

function provider(client: BoatClient, account = ACCOUNT) {
  const session: BoatSession = {
    status: "available",
    facts: {
      account: { id: accountId.parse(account), login: "octocat", zeroDataRetention: false },
      limits: { wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null },
    },
    client,
    settings: { ok: true, apiKey: "boat_test", idleMs: null, defaultPreset: "small" },
  };
  const access: BoatAccess = { configuration: async () => session, session: async () => session };
  const bootstraps: string[] = [];
  const declaration = boatMachineProvider({
    access,
    gate: createStartGate(),
    ownerId: OWNER,
    bootstrap: async ({ key }) => (bootstraps.push(key), { hostId: "host_1" }),
  });
  return { declaration, bootstraps };
}

const quiet = { step: () => {}, log: () => {} };

async function create(declaration: ReturnType<typeof provider>["declaration"], key: string, attempt = 1) {
  const checkpoints: Exclude<JsonValue, null>[] = [];
  const result = await declaration.create({
    inputs: {},
    key,
    attempt,
    checkpoint: async (resource) => void checkpoints.push(resource),
    report: quiet,
    signal: AbortSignal.timeout(10_000),
  });
  return { result, checkpoints };
}

test("create adopts the labelled sandbox an interrupted create left behind", async () => {
  const boat = fakeBoat();
  const left = boat.add(machineLabels(OWNER, "thr_1"));
  const { declaration, bootstraps } = provider(boat.client);

  const { result, checkpoints } = await create(declaration, "thr_1");

  assert.deepEqual(boat.posts, []);
  assert.deepEqual(checkpoints, [{ sandboxId: left.id, key: "thr_1", accountId: ACCOUNT }]);
  assert.deepEqual(bootstraps, ["thr_1"]);
  assert.equal(result.status, "created");
});

test("two creates with one key make one POST and one sandbox", async () => {
  const boat = fakeBoat();
  const { declaration } = provider(boat.client);

  const first = await create(declaration, "thr_1");
  const second = await create(declaration, "thr_1");

  assert.equal(boat.posts.length, 1);
  assert.equal(boat.sandboxes.size, 1);
  assert.deepEqual(first.checkpoints, second.checkpoints);
});

test("two threads get two sandboxes under two Idempotency-Keys", async () => {
  const boat = fakeBoat();
  const { declaration } = provider(boat.client);

  await create(declaration, "thr_1");
  await create(declaration, "thr_2");

  assert.deepEqual(boat.posts, [`bb:${OWNER}:thr_1:1`, `bb:${OWNER}:thr_2:1`]);
  assert.equal(boat.sandboxes.size, 2);
});

test("a refused create reports boat's message and checkpoints nothing", async () => {
  const boat = fakeBoat();
  const message = "The 16 vCPU / 32 GB 'xlarge' Sandbox requires the $100/month Boat plan or higher.";
  boat.client.create = async () => {
    throw new BoatApiError(403, "machine_class_plan_required", message, null, false);
  };
  const { declaration } = provider(boat.client);

  const { result, checkpoints } = await create(declaration, "thr_1");

  assert.deepEqual(result, { status: "failed", message });
  assert.deepEqual(checkpoints, []);
});

test("remove deletes the sandbox, and a sandbox already gone counts as removed", async () => {
  const boat = fakeBoat();
  const { declaration } = provider(boat.client);
  const { checkpoints } = await create(declaration, "thr_1");
  const [resource] = checkpoints;
  if (resource === undefined) throw new Error("create checkpointed nothing");
  const remove = () => declaration.remove({ hostId: "host_1", resource, report: quiet, signal: AbortSignal.timeout(10_000) });

  assert.deepEqual(await remove(), { status: "removed" });
  assert.equal(boat.sandboxes.size, 0);
  assert.deepEqual(await remove(), { status: "removed" });
});

test("remove refuses when the configured key is for another boat account", async () => {
  const boat = fakeBoat();
  const resource = { sandboxId: boat.add(machineLabels(OWNER, "thr_1")).id, key: "thr_1", accountId: ACCOUNT };
  const { declaration } = provider(boat.client, "sandbox_account_2");

  const result = await declaration.remove({ hostId: "host_1", resource, report: quiet, signal: AbortSignal.timeout(10_000) });

  assert.equal(result.status, "failed");
  assert.equal(boat.sandboxes.size, 1);
});

test("reconcileCleanup deletes whatever boat made for the key", async () => {
  const boat = fakeBoat();
  boat.add(machineLabels(OWNER, "thr_1"));
  const kept = boat.add(machineLabels(OWNER, "thr_2"));
  const { declaration } = provider(boat.client);

  const result = await declaration.reconcileCleanup({ key: "thr_1", report: quiet, signal: AbortSignal.timeout(10_000) });

  assert.deepEqual(result, { status: "removed" });
  assert.deepEqual([...boat.sandboxes.keys()], [kept.id]);
});

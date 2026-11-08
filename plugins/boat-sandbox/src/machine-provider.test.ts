import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession } from "./boat/access.ts";
import { BoatApiError, type BoatClient, type CreateSandboxBody, type Labels } from "./boat/client.ts";
import { toSandbox, type Sandbox, type SandboxId } from "./boat/sandbox.ts";
import { createStartGate, type StartGate } from "./boat/start-gate.ts";
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
  const calls: string[] = [];
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
    async stop(id) {
      calls.push(`stop ${id}`);
      const sandbox = sandboxes.get(id);
      if (sandbox !== undefined) sandboxes.set(id, { ...sandbox, phase: "stopped", stoppedAt: Date.now() });
    },
    // Auto-stop counts from the resume, with the TTL the resume sends.
    async resume(id, ttlSeconds) {
      calls.push(`resume ${id} ttl ${ttlSeconds}`);
      const sandbox = sandboxes.get(id);
      if (sandbox !== undefined) sandboxes.set(id, { ...sandbox, phase: "running", stoppedAt: null, archiveAfter: Date.now() + ttlSeconds * 1000 });
    },
    async setTtl(id, ttlSeconds) {
      calls.push(`ttl ${id} ${ttlSeconds}`);
      const sandbox = sandboxes.get(id);
      if (sandbox !== undefined) sandboxes.set(id, { ...sandbox, archiveAfter: Date.now() + ttlSeconds * 1000 });
    },
    run: async () => ({ exitCode: 0 }),
    writeFile: async () => {},
  };
  /** A sandbox boat stopped `minutesAgo` minutes ago. */
  const stopped = (minutesAgo: number): Sandbox => {
    const sandbox = { ...add(machineLabels(OWNER, "thr_1")), phase: "stopped" as const, stoppedAt: Date.now() - minutesAgo * 60_000 };
    sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  };
  return { client, sandboxes, posts, calls, add, stopped };
}

/** A start gate that counts the starts it was asked for. */
function countingGate() {
  const gate = createStartGate();
  const counted = { starts: 0 };
  const counting: StartGate = {
    start: (start, signal) => (counted.starts++, gate.start(start, signal)),
    startUncounted: gate.startUncounted,
  };
  return { gate: counting, counted };
}

function provider(client: BoatClient, account = ACCOUNT, gate: StartGate = createStartGate()) {
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
  const touched: string[] = [];
  const declaration = boatMachineProvider({
    access,
    gate,
    ownerId: OWNER,
    idle: { touch: async (hostId) => void touched.push(hostId) },
    bootstrap: async ({ key }) => (bootstraps.push(key), { hostId: "host_1" }),
  });
  return { declaration, bootstraps, touched };
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

/** Core requires suspend and resume together; a provider without them fails here. */
function suspendResume({ declaration }: ReturnType<typeof provider>) {
  const { suspend, resume } = declaration;
  if (suspend === undefined || resume === undefined) throw new Error("the provider declares no suspend and resume");
  return { suspend, resume };
}

const lifecycle = (sandbox: Sandbox) => ({
  hostId: "host_1",
  resource: { sandboxId: sandbox.id, key: "thr_1", accountId: ACCOUNT },
  checkpoint: async () => {},
  report: quiet,
  signal: AbortSignal.timeout(10_000),
});

test("suspend stops a running sandbox and keeps the resource", async () => {
  const boat = fakeBoat();
  const sandbox = boat.add(machineLabels(OWNER, "thr_1"));
  const { suspend } = suspendResume(provider(boat.client));

  const result = await suspend(lifecycle(sandbox));

  assert.deepEqual(boat.calls, [`stop ${sandbox.id}`]);
  assert.equal(boat.sandboxes.get(sandbox.id)?.phase, "stopped");
  assert.deepEqual(result, { resource: lifecycle(sandbox).resource });
});

test("suspend on an already stopped sandbox is a no-op", async () => {
  const boat = fakeBoat();
  const sandbox = boat.stopped(3);
  const { suspend } = suspendResume(provider(boat.client));

  await suspend(lifecycle(sandbox));

  assert.deepEqual(boat.calls, []);
});

test("resume within the kept window bypasses the start gate", async () => {
  const boat = fakeBoat();
  const sandbox = boat.stopped(2);
  const { gate, counted } = countingGate();
  const resumer = provider(boat.client, ACCOUNT, gate);
  const { bootstraps, touched } = resumer;
  const { resume } = suspendResume(resumer);

  await resume(lifecycle(sandbox));

  assert.deepEqual(boat.calls, [`resume ${sandbox.id} ttl 7200`]);
  assert.equal(counted.starts, 0);
  assert.deepEqual(bootstraps, ["thr_1"]);
  assert.deepEqual(touched, ["host_1"]);
});

test("resume after the kept window goes through the start gate", async () => {
  const boat = fakeBoat();
  const sandbox = boat.stopped(30);
  const { gate, counted } = countingGate();
  const { resume } = suspendResume(provider(boat.client, ACCOUNT, gate));

  await resume(lifecycle(sandbox));

  assert.deepEqual(boat.calls, [`resume ${sandbox.id} ttl 7200`]);
  assert.equal(counted.starts, 1);
});

test("resume in the kept window's last minute still bypasses the start gate", async () => {
  const boat = fakeBoat();
  const sandbox = boat.stopped(9.5);
  const { gate, counted } = countingGate();
  const { resume } = suspendResume(provider(boat.client, ACCOUNT, gate));

  await resume(lifecycle(sandbox));

  assert.deepEqual(boat.calls, [`resume ${sandbox.id} ttl 7200`]);
  assert.equal(counted.starts, 0);
});

test("a kept resume boat counts and refuses with 429 holds back later starts", async () => {
  const boat = fakeBoat();
  const sandbox = boat.stopped(2);
  const resumes: SandboxId[] = [];
  const refusing: BoatClient = {
    ...boat.client,
    async resume(id) {
      resumes.push(id);
      throw new BoatApiError(429, "rate_limited", "Start limit reached for this hour.", 30 * 60_000, false);
    },
  };
  const resumer = provider(refusing);

  await assert.rejects(suspendResume(resumer).resume(lifecycle(sandbox)), /start limit is reached/);
  const { result } = await create(resumer.declaration, "thr_2");

  assert.deepEqual(resumes, [sandbox.id]);
  assert.equal(result.status, "failed");
  assert.deepEqual(boat.posts, []);
});

test("resume of a running sandbox renews its lease and re-enrolls it", async () => {
  const boat = fakeBoat();
  const sandbox = boat.add(machineLabels(OWNER, "thr_1"));
  const resumer = provider(boat.client);
  const { resume } = suspendResume(resumer);

  await resume(lifecycle(sandbox));

  assert.deepEqual(boat.calls, [`ttl ${sandbox.id} 7200`]);
  assert.deepEqual(resumer.bootstraps, ["thr_1"]);
});

test("resume puts the 2-hour lease back, whatever auto-stop was set on the sandbox before", async () => {
  const boat = fakeBoat();
  // A 20-second auto-stop set by hand: boat keeps it for later resumes unless the resume sends another.
  const sandbox = { ...boat.stopped(30), archiveAfter: Date.now() + 20_000 };
  boat.sandboxes.set(sandbox.id, sandbox);
  const { resume } = suspendResume(provider(boat.client));

  await resume(lifecycle(sandbox));

  const archiveAfter = boat.sandboxes.get(sandbox.id)?.archiveAfter ?? 0;
  assert.ok(archiveAfter - Date.now() > 7190_000, `auto-stop only ${Math.round((archiveAfter - Date.now()) / 1000)} s away`);
});

test("resume of a sandbox boat no longer has says to remove the machine", async () => {
  const boat = fakeBoat();
  const sandbox = boat.add(machineLabels(OWNER, "thr_1"));
  boat.sandboxes.delete(sandbox.id);
  const resumer = provider(boat.client);
  const { resume } = suspendResume(resumer);

  await assert.rejects(resume(lifecycle(sandbox)), {
    message: `boat sandbox ${sandbox.id} no longer exists; remove this machine.`,
  });
  assert.deepEqual(resumer.bootstraps, []);
});

test("resume refuses a daemon that enrolls as another machine", async () => {
  const boat = fakeBoat();
  const sandbox = boat.stopped(2);
  const resumer = provider(boat.client);
  const { resume } = suspendResume(resumer);

  await assert.rejects(resume({ ...lifecycle(sandbox), hostId: "host_2" }), /enrolled as host_1, not as machine host_2/);
  assert.deepEqual(resumer.touched, []);
});

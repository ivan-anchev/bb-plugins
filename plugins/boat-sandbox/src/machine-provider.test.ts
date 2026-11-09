import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { BoatAccess, BoatSession } from "./boat/access.ts";
import { BoatApiError, type BoatClient, type CreateSandboxBody, type Labels } from "./boat/client.ts";
import { toSandbox, type Sandbox, type SandboxId } from "./boat/sandbox.ts";
import { createStartGate, type StartGate } from "./boat/start-gate.ts";
import { accountId, sandboxId, wireMe, type SavedSnapshot } from "./boat/wire.ts";
import type { MachineInputs } from "./launch.ts";
import { boatMachineProvider } from "./machine-provider.ts";
import { machineLabels } from "./ownership.ts";

const OWNER = "owner-1";
const ACCOUNT = "sandbox_account_1";
const CAPTURED = JSON.parse(readFileSync(new URL("./boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;

const NODE_TOOLS: SavedSnapshot = { name: "node-tools", status: "ready", error: null, savedFrom: "small", savedAt: "2026-11-09T10:12:00.000Z" };

/** boat in memory: Idempotency-Keys and labels behave as on the live API (spike Q1, Q9). */
function fakeBoat() {
  const sandboxes = new Map<SandboxId, Sandbox>();
  const byIdempotencyKey = new Map<string, Sandbox>();
  const posts: string[] = [];
  const bodies: CreateSandboxBody[] = [];
  const calls: string[] = [];
  /** Every command run in a sandbox; `answer` decides each one's output and exit code. */
  const commands: string[] = [];
  const shell = { answer: (_command: string) => ({ output: "", exitCode: 0 }) };
  /** The saved snapshots on the account, and whether boat puts the account's logins on a new sandbox. */
  const account = { templates: [NODE_TOOLS], holdsLogins: true };
  const add = (labels: Labels): Sandbox => {
    const id = sandboxId.parse(`bx_${"abcdefghjkmnpqrs".slice(sandboxes.size, sandboxes.size + 8)}`);
    const sandbox = toSandbox({ ...CAPTURED, id, labels, state: "idle", holdsCreatorLogins: account.holdsLogins });
    if (sandbox === null) throw new Error("unreachable: idle is present");
    sandboxes.set(id, sandbox);
    return sandbox;
  };
  const client: BoatClient = {
    me: async () => wireMe.parse({ user: { id: ACCOUNT, login: "octocat", zeroDataRetention: false } }),
    limits: async () => ({ wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null }),
    savedSnapshots: async () => account.templates,
    get: async (id) => sandboxes.get(id) ?? null,
    list: async (labels) =>
      [...sandboxes.values()].filter((sandbox) => Object.entries(labels).every(([key, value]) => sandbox.labels[key] === value)),
    async create(body: CreateSandboxBody, idempotencyKey: string) {
      posts.push(idempotencyKey);
      bodies.push(body);
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
    async run(_id, { command, onOutput }) {
      commands.push(command);
      const { output, exitCode } = shell.answer(command);
      onOutput(output);
      return { exitCode };
    },
    writeFile: async () => {},
  };
  /** A sandbox boat stopped `minutesAgo` minutes ago. */
  const stopped = (minutesAgo: number): Sandbox => {
    const sandbox = { ...add(machineLabels(OWNER, "thr_1")), phase: "stopped" as const, stoppedAt: Date.now() - minutesAgo * 60_000 };
    sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  };
  return { client, sandboxes, posts, bodies, calls, commands, shell, account, add, stopped };
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
    settings: { ok: true, apiKey: "boat_test", idleMs: null, defaults: { template: null, preset: "small" } },
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
  /** What core gets from validate for these inputs. */
  const validate = (inputs: MachineInputs) => {
    if (declaration.validate === undefined) throw new Error("the provider declares no validate");
    return declaration.validate({ inputs });
  };
  return { declaration, validate, bootstraps, touched };
}

const quiet = { step: () => {}, log: () => {} };

async function create(declaration: ReturnType<typeof provider>["declaration"], key: string, attempt = 1, inputs: MachineInputs = {}) {
  const checkpoints: Exclude<JsonValue, null>[] = [];
  const steps: string[] = [];
  const logs: string[] = [];
  const result = await declaration.create({
    inputs,
    key,
    attempt,
    checkpoint: async (resource) => void checkpoints.push(resource),
    report: { step: (step) => void steps.push(step), log: (text) => void logs.push(text) },
    signal: AbortSignal.timeout(10_000),
  });
  return { result, checkpoints, steps, logs };
}

/** Which plugin step each command a sandbox ran was. */
const kindOf = (command: string): string =>
  command.includes("bb-boat/instance-key") ? "reset" : command.includes("EnvironmentFile=-%t/boat-sign-ins.env") ? "sign-ins" : command;

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

test("validate asks boat for its saved snapshots and refuses a name boat does not have", async () => {
  const { validate } = provider(fakeBoat().client);

  assert.deepEqual(await validate({ template: "node-tools" }), { action: "accept" });
  assert.deepEqual(await validate({ template: "nope" }), {
    action: "refuse",
    message: 'No saved snapshot "nope" on this boat account. Run `bb boat templates` to list them.',
  });
});

test("validate refuses with boat's message when boat cannot list the snapshots", async () => {
  const boat = fakeBoat();
  boat.client.savedSnapshots = async () => {
    throw new BoatApiError(503, "unavailable", "boat is down for maintenance.", null, false);
  };

  assert.deepEqual(await provider(boat.client).validate({}), { action: "refuse", message: "boat is down for maintenance." });
});

test("a create from a template sends its name as `from`, never noEnv, and says so", async () => {
  const boat = fakeBoat();
  const { declaration } = provider(boat.client);

  const { result, steps } = await create(declaration, "thr_1", 1, { template: "node-tools", preset: "large" });
  await create(declaration, "thr_2", 1, { template: null });

  assert.equal(result.status, "created");
  assert.deepEqual(boat.bodies, [
    { name: "bb thr_1", type: "large", labels: machineLabels(OWNER, "thr_1"), ttlSeconds: 7200, from: "node-tools" },
    { name: "bb thr_2", type: "small", labels: machineLabels(OWNER, "thr_2"), ttlSeconds: 7200 },
  ]);
  assert.deepEqual(steps, ["Creating a large boat sandbox from template node-tools"]);
});

test("a template boat no longer has fails the create before any sandbox exists", async () => {
  const boat = fakeBoat();
  const { declaration } = provider(boat.client);
  boat.account.templates = [];

  const { result, checkpoints } = await create(declaration, "thr_1", 1, { template: "node-tools" });

  assert.equal(result.status, "failed");
  assert.deepEqual([boat.posts, checkpoints], [[], []]);
});

test("a sandbox boat started as no-env fails the create after its checkpoint, so core deletes it", async () => {
  const boat = fakeBoat();
  boat.account.holdsLogins = false;
  const { declaration, bootstraps } = provider(boat.client);

  const { result, checkpoints } = await create(declaration, "thr_1", 1, { template: "node-tools" });

  assert.deepEqual(result, {
    status: "failed",
    message:
      "boat started sandbox bx_abcdefgh from template node-tools as a no-env sandbox, so it would get no sign-ins. " +
      "A template saved from a no-env sandbox makes only no-env sandboxes; save the template from a sandbox in an environment.",
  });
  assert.equal(checkpoints.length, 1);
  assert.deepEqual([boat.commands, bootstraps], [[], []]);
});

test("create resets another machine's bb state before passing sign-ins and enrolling; resume never resets", async () => {
  const boat = fakeBoat();
  boat.shell.answer = (command) => ({
    output: kindOf(command) === "reset" ? "removed ~/.config/systemd/user/bb-host-daemon-x.service\nremoved ~/.bb-machines\n" : "",
    exitCode: 0,
  });
  const { declaration } = provider(boat.client);

  const { steps, logs } = await create(declaration, "thr_1", 1, { template: "node-tools" });
  const created = boat.commands.map(kindOf);
  await suspendResume(provider(boat.client)).resume(lifecycle(boat.stopped(2)));

  assert.deepEqual(created, ["reset", "sign-ins"]);
  assert.deepEqual(boat.commands.slice(2).map(kindOf), ["sign-ins"]);
  assert.match(boat.commands[0] ?? "", /'thr_1'/);
  assert.deepEqual(steps, ["Creating a small boat sandbox from template node-tools"]);
  assert.deepEqual(logs, [
    "Removed the bb machine state template node-tools carried from another machine: ~/.config/systemd/user/bb-host-daemon-x.service, ~/.bb-machines",
  ]);
});

test("a create on a clean disk reports no reset", async () => {
  const { declaration } = provider(fakeBoat().client);

  const { steps, logs } = await create(declaration, "thr_1");

  assert.deepEqual([steps, logs], [["Creating a small boat sandbox from boat's stock image"], []]);
});

test("a create whose sign-in drop-in fails reports it and never enrolls the daemon", async () => {
  const boat = fakeBoat();
  boat.shell.answer = (command) => ({ output: "", exitCode: kindOf(command) === "sign-ins" ? 1 : 0 });
  const { declaration, bootstraps } = provider(boat.client);

  const { result } = await create(declaration, "thr_1");

  assert.equal(result.status, "failed");
  assert.match(result.status === "failed" ? result.message : "", /Could not pass boat's sign-ins to bb's daemon on sandbox bx_\w+ \(exit 1\)/);
  assert.deepEqual(bootstraps, []);
});

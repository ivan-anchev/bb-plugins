import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { BoatAccess, BoatSession } from "../boat/access.ts";
import type { BoatClient } from "../boat/client.ts";
import { toSandbox, type Sandbox, type SandboxId } from "../boat/sandbox.ts";
import { accountId, sandboxId } from "../boat/wire.ts";
import type { IdleClock } from "../idle-clock.ts";
import { PROVIDER_ID } from "../machine-provider.ts";
import { createSweep } from "./run.ts";

const CAPTURED = JSON.parse(readFileSync(new URL("../boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;
const ACCOUNT = accountId.parse("sandbox_account_1");
const MINUTE = 60_000;
const IDLE_MS = 15 * MINUTE;

interface FakeHost {
  id: string;
  sandbox: Sandbox;
  /** Threads on it that are pending, starting, active or stopping. */
  busyThreads: number;
}

/** A running sandbox whose auto-stop is `leaseMinutes` away. */
function sandbox(suffix: string, leaseMinutes = 120): Sandbox {
  const id = sandboxId.parse(`bx_${suffix}`);
  const parsed = toSandbox({ ...CAPTURED, id, state: "idle", archiveAfter: new Date(Date.now() + leaseMinutes * MINUTE).toISOString() });
  if (parsed === null) throw new Error("unreachable: idle is present");
  return parsed;
}

/** bb, boat and the idle clock in memory, with hooks for what happens while the sweep works. */
function world(hosts: FakeHost[]) {
  const lastActive = new Map<string, number>();
  const touched: string[] = [];
  const suspended: string[] = [];
  const renewed: SandboxId[] = [];
  const warnings: string[] = [];
  const hooks = { duringList: () => {}, onRead: () => {}, onTouch: () => {}, onSuspend: () => {}, onRenew: () => {} };
  const facts = (host: FakeHost) => ({ id: host.id, machineProviderId: PROVIDER_ID, lifecycle: { phase: "active" as const } });
  const find = (hostId: string) => {
    const host = hosts.find(({ id }) => id === hostId);
    if (host === undefined) throw new Error(`no host ${hostId}`);
    return host;
  };

  const unused = () => Promise.reject(new Error("the sweep never calls this"));
  const client: BoatClient = {
    me: unused,
    limits: unused,
    get: unused,
    create: unused,
    remove: unused,
    stop: unused,
    resume: unused,
    run: unused,
    writeFile: unused,
    async list() {
      hooks.duringList();
      return hosts.map(({ sandbox }) => sandbox);
    },
    async setTtl(id) {
      renewed.push(id);
      hooks.onRenew();
    },
  };
  const session: BoatSession = {
    status: "available",
    facts: { account: { id: ACCOUNT, login: "octocat", zeroDataRetention: false }, limits: { wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null } },
    client,
    settings: { ok: true, apiKey: "boat_test", idleMs: IDLE_MS, defaultPreset: "small" },
  };
  const access: BoatAccess = { configuration: async () => session, session: async () => session };
  const idle: IdleClock = {
    async touch(hostId) {
      touched.push(hostId);
      lastActive.set(hostId, Date.now());
      hooks.onTouch();
    },
    async read(hostId) {
      hooks.onRead();
      return lastActive.get(hostId) ?? null;
    },
    forget: async (hostId) => void lastActive.delete(hostId),
  };
  const bb = {
    sdk: {
      hosts: {
        list: async () => hosts.map(facts),
        get: async ({ hostId }: { hostId: string }) => facts(find(hostId)),
        async experimental_suspend({ hostId }: { hostId: string }) {
          hooks.onSuspend();
          suspended.push(hostId);
        },
      },
      threads: { count: async ({ hostId, status }: { hostId: string; status: string }) => ({ total: status === "active" ? find(hostId).busyThreads : 0 }) },
    },
    experimental_machines: {
      getResource: async (hostId: string) => ({ sandboxId: find(hostId).sandbox.id, key: hostId, accountId: ACCOUNT }),
    },
    log: { info: () => {}, warn: (message: string) => void warnings.push(message) },
  };
  /** The machine last did work `minutesAgo` minutes ago. */
  const idleFor = (hostId: string, minutesAgo: number) => lastActive.set(hostId, Date.now() - minutesAgo * MINUTE);
  const sweep = createSweep({ bb, access, idle, ownerId: "owner-1" });
  return { sweep, hooks, idleFor, touched, suspended, renewed, warnings };
}

const signal = () => AbortSignal.timeout(10_000);

test("an idle machine is suspended", async () => {
  const boat = world([{ id: "host_1", sandbox: sandbox("abcdefgh"), busyThreads: 0 }]);
  boat.idleFor("host_1", 20);

  await boat.sweep(signal());

  assert.deepEqual(boat.suspended, ["host_1"]);
});

test("a follow-up that starts a turn after the sweep looked cancels the suspend", async () => {
  const host = { id: "host_1", sandbox: sandbox("abcdefgh"), busyThreads: 0 };
  const boat = world([host]);
  boat.idleFor("host_1", 20);
  boat.hooks.duringList = () => void (host.busyThreads = 1);

  await boat.sweep(signal());

  assert.deepEqual(boat.suspended, []);
});

test("terminal input after the sweep looked cancels the suspend", async () => {
  const boat = world([{ id: "host_1", sandbox: sandbox("abcdefgh"), busyThreads: 0 }]);
  boat.idleFor("host_1", 20);
  boat.hooks.duringList = () => boat.idleFor("host_1", 0);

  await boat.sweep(signal());

  assert.deepEqual(boat.suspended, []);
});

test("a refused suspend leaves the machine on a renewed lease", async () => {
  const host = { id: "host_1", sandbox: sandbox("abcdefgh", 10), busyThreads: 0 };
  const boat = world([host]);
  boat.idleFor("host_1", 20);
  boat.hooks.onSuspend = () => {
    throw Object.assign(new Error("A launch is in progress on this machine."), { code: "machine_busy" });
  };

  await boat.sweep(signal());

  assert.deepEqual(boat.renewed, [host.sandbox.id]);
  assert.deepEqual(boat.warnings, []);
});

test("a sweep out of time applies nothing more and rejects", async () => {
  const boat = world([
    { id: "host_1", sandbox: sandbox("abcdefgh"), busyThreads: 1 },
    { id: "host_2", sandbox: sandbox("bcdefghj"), busyThreads: 1 },
  ]);
  const timeLimit = new AbortController();
  boat.hooks.onTouch = () => timeLimit.abort(new Error("out of time"));

  await assert.rejects(boat.sweep(timeLimit.signal), /out of time/);
  assert.deepEqual(boat.touched, ["host_1"]);
});

test("an action cut short by the time limit is not reported as a failed action", async () => {
  const boat = world([{ id: "host_1", sandbox: sandbox("abcdefgh", 10), busyThreads: 0 }]);
  boat.idleFor("host_1", 1);
  const timeLimit = new AbortController();
  boat.hooks.onRenew = () => {
    timeLimit.abort(new Error("out of time"));
    throw timeLimit.signal.reason;
  };

  await assert.rejects(boat.sweep(timeLimit.signal), /out of time/);
  assert.deepEqual(boat.warnings, []);
});

test("time running out during the pre-suspend re-check stops the suspend", async () => {
  const boat = world([{ id: "host_1", sandbox: sandbox("abcdefgh"), busyThreads: 0 }]);
  boat.idleFor("host_1", 20);
  const timeLimit = new AbortController();
  let reads = 0;
  // The first read is the sweep's look; the second is the re-check, which has no signal to cut it short.
  boat.hooks.onRead = () => void (++reads === 2 && timeLimit.abort(new Error("out of time")));

  await assert.rejects(boat.sweep(timeLimit.signal), /out of time/);
  assert.deepEqual(boat.suspended, []);
  assert.deepEqual(boat.warnings, []);
});

test("a sweep that runs out of time during its last action rejects though the action succeeded", async () => {
  const boat = world([{ id: "host_1", sandbox: sandbox("abcdefgh"), busyThreads: 0 }]);
  boat.idleFor("host_1", 20);
  const timeLimit = new AbortController();
  boat.hooks.onSuspend = () => timeLimit.abort(new Error("out of time"));

  await assert.rejects(boat.sweep(timeLimit.signal), /out of time/);
  assert.deepEqual(boat.suspended, ["host_1"]);
});

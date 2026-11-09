import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { BoatAccess, BoatSession } from "../boat/access.ts";
import type { BoatClient } from "../boat/client.ts";
import { toSandbox, type Sandbox, type SandboxId } from "../boat/sandbox.ts";
import { accountId, sandboxId } from "../boat/wire.ts";
import { boatCli } from "../cli.ts";
import type { IdleClock } from "../idle-clock.ts";
import { PROVIDER_ID } from "../machine-provider.ts";
import { machineLabels } from "../ownership.ts";
import type { HostPhase } from "./plan.ts";
import { createSweep } from "./run.ts";

const CAPTURED = JSON.parse(readFileSync(new URL("../boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;
const ACCOUNT = accountId.parse("sandbox_account_1");
const OWNER = "owner-1";
const MINUTE = 60_000;
const IDLE_MS = 15 * MINUTE;

interface FakeHost {
  id: string;
  phase?: HostPhase;
  /** null: boat no longer has it. */
  sandbox: Sandbox | null;
  /** Threads on it that are pending, starting, active or stopping. */
  busyThreads: number;
  /** Its sandbox id when `sandbox` is null. */
  sandboxId?: SandboxId;
}

/** An owned sandbox: running with its auto-stop `leaseMinutes` away unless `wire` says otherwise. */
function sandbox(suffix: string, leaseMinutes = 120, wire: object = {}): Sandbox {
  const id = sandboxId.parse(`bx_${suffix}`);
  const archiveAfter = new Date(Date.now() + leaseMinutes * MINUTE).toISOString();
  const parsed = toSandbox({ ...CAPTURED, id, state: "idle", labels: machineLabels(OWNER, suffix), archiveAfter, ...wire });
  if (parsed === null) throw new Error("unreachable: the state is present");
  return parsed;
}

/** bb, boat and the idle clock in memory, with hooks for what happens while the sweep works. */
function world(hosts: FakeHost[], orphans: Sandbox[] = []) {
  const lastActive = new Map<string, number>();
  const touched: string[] = [];
  const suspended: string[] = [];
  const reconciled: string[] = [];
  const renewed: SandboxId[] = [];
  const stopped: SandboxId[] = [];
  const lookedUp: SandboxId[] = [];
  const warnings: string[] = [];
  const hooks = { duringList: () => {}, onRead: () => {}, onTouch: () => {}, onSuspend: () => {}, onRenew: () => {} };
  const facts = (host: FakeHost) => ({ id: host.id, machineProviderId: PROVIDER_ID, lifecycle: { phase: host.phase ?? ("active" as const) } });
  const find = (hostId: string) => {
    const host = hosts.find(({ id }) => id === hostId);
    if (host === undefined) throw new Error(`no host ${hostId}`);
    return host;
  };
  const onBoat = () => [...hosts.flatMap(({ sandbox }) => (sandbox === null ? [] : [sandbox])), ...orphans];

  const unused = () => Promise.reject(new Error("the sweep never calls this"));
  const client: BoatClient = {
    me: unused,
    limits: unused,
    savedSnapshots: unused,
    create: unused,
    remove: unused,
    resume: unused,
    run: unused,
    writeFile: unused,
    async get(id) {
      lookedUp.push(id);
      return onBoat().find((each) => each.id === id) ?? null;
    },
    async list(labels) {
      hooks.duringList();
      return onBoat().filter((each) => Object.entries(labels).every(([key, value]) => each.labels[key] === value));
    },
    async setTtl(id) {
      renewed.push(id);
      hooks.onRenew();
    },
    stop: async (id) => void stopped.push(id),
  };
  const session: BoatSession = {
    status: "available",
    facts: { account: { id: ACCOUNT, login: "octocat", zeroDataRetention: false }, limits: { wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null } },
    client,
    settings: { ok: true, apiKey: "boat_test", idleMs: IDLE_MS, defaults: { template: null, preset: "small" } },
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
        experimental_reconcile: async ({ hostId }: { hostId: string }) => void reconciled.push(hostId),
      },
      threads: { count: async ({ hostId, status }: { hostId: string; status: string }) => ({ total: status === "active" ? find(hostId).busyThreads : 0 }) },
    },
    experimental_machines: {
      async getResource(hostId: string) {
        const host = find(hostId);
        return { sandboxId: host.sandbox?.id ?? host.sandboxId ?? null, key: hostId, accountId: ACCOUNT };
      },
    },
    log: { info: () => {}, warn: (message: string) => void warnings.push(message) },
  };
  /** The machine last did work `minutesAgo` minutes ago. */
  const idleFor = (hostId: string, minutesAgo: number) => lastActive.set(hostId, Date.now() - minutesAgo * MINUTE);
  const sweep = createSweep({ bb, access, idle, ownerId: OWNER });
  /** `bb boat sandboxes --json`, through the plugin's CLI registration. */
  async function sandboxesJson() {
    const { exitCode, stdout } = await boatCli(access, { bb, idle, ownerId: OWNER }).run(["sandboxes", "--json"], {});
    assert.equal(exitCode, 0);
    return JSON.parse(stdout ?? "");
  }
  return { sweep, sandboxesJson, hooks, idleFor, touched, suspended, reconciled, renewed, stopped, lookedUp, warnings };
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

test("an active machine whose sandbox boat stopped by itself is recorded as suspended", async () => {
  const boat = world([{ id: "host_1", sandbox: sandbox("abcdefgh", 0, { state: "archived", stop: null }), busyThreads: 1 }]);

  await boat.sweep(signal());

  assert.deepEqual(boat.suspended, ["host_1"]);
  assert.deepEqual([boat.renewed, boat.stopped, boat.touched], [[], [], []]);
});

test("an active machine whose sandbox was deleted outside bb is recorded as suspended", async () => {
  const id = sandboxId.parse("bx_abcdefgh");
  const boat = world([{ id: "host_1", sandbox: null, sandboxId: id, busyThreads: 0 }]);

  await boat.sweep(signal());

  assert.deepEqual(boat.lookedUp, [id]);
  assert.deepEqual(boat.suspended, ["host_1"]);
});

test("a machine's sandbox missing from the owner listing is looked up, not taken for deleted", async () => {
  // Made under an earlier owner id: the listing for this owner does not show it.
  const earlier = sandbox("abcdefgh", 120, { labels: machineLabels("owner-0", "host_1") });
  const boat = world([{ id: "host_1", sandbox: earlier, busyThreads: 1 }]);

  await boat.sweep(signal());

  assert.deepEqual(boat.lookedUp, [earlier.id]);
  assert.deepEqual([boat.suspended, boat.touched], [[], ["host_1"]]);
});

test("a sandbox resumed by hand under a suspended machine is stopped again through core", async () => {
  const boat = world([{ id: "host_1", phase: "suspended", sandbox: sandbox("abcdefgh"), busyThreads: 0 }]);

  await boat.sweep(signal());

  assert.deepEqual(boat.reconciled, ["host_1"]);
  assert.deepEqual([boat.suspended, boat.stopped, boat.renewed], [[], [], []]);
});

test("an awake orphan older than 15 minutes is stopped, and a younger one is not", async () => {
  const old = sandbox("rrrrrrr2", 120, { createdAt: new Date(Date.now() - 16 * MINUTE).toISOString() });
  const young = sandbox("rrrrrrr3", 120, { createdAt: new Date(Date.now() - 5 * MINUTE).toISOString() });
  const boat = world([], [old, young]);

  await boat.sweep(signal());

  // The fake boat rejects `remove`, so a delete would have failed the action with a warning.
  assert.deepEqual(boat.stopped, [old.id]);
  assert.match(boat.warnings.join("\n"), new RegExp(`Stopping boat sandbox ${old.id}: no bb machine uses it`));
});

test("bb boat sandboxes lists healthy, boat-stopped, deleted and orphan sandboxes with the sweep's plan", async () => {
  const healthy = sandbox("hhhhhhh2");
  const stoppedByBoat = sandbox("sssssss2", 0, { state: "archived", stop: null, archiveAfter: null });
  const deleted = sandboxId.parse("bx_ddddddd2");
  const stoppedAt = new Date(Date.now() - 30 * MINUTE).toISOString();
  const createdAt = new Date(Date.now() - 60 * MINUTE).toISOString();
  const orphan = sandbox("rrrrrrr2", 120, { state: "archived", stoppedAt, stop: { endedAt: stoppedAt }, createdAt });
  const boat = world(
    [
      { id: "host_1", sandbox: healthy, busyThreads: 0 },
      { id: "host_2", sandbox: stoppedByBoat, busyThreads: 0 },
      { id: "host_3", phase: "suspended", sandbox: null, sandboxId: deleted, busyThreads: 0 },
    ],
    [orphan],
  );
  boat.idleFor("host_1", 1);

  const rows = await boat.sandboxesJson();

  assert.deepEqual(
    rows.map(({ sandboxId, boatPhase, machine, notes }: Record<string, unknown>) => ({ sandboxId, boatPhase, machine, notes })),
    [
      { sandboxId: healthy.id, boatPhase: "running", machine: { hostId: "host_1", phase: "active" }, notes: [] },
      {
        sandboxId: stoppedByBoat.id,
        boatPhase: "stopped",
        machine: { hostId: "host_2", phase: "active" },
        notes: ["stopped by boat", "sweep will record the machine as suspended"],
      },
      {
        sandboxId: deleted,
        boatPhase: "gone",
        machine: { hostId: "host_3", phase: "suspended" },
        notes: ["no longer exists on boat, so a follow-up cannot resume it; remove the machine with `bb machine remove host_3 --yes`"],
      },
      { sandboxId: orphan.id, boatPhase: "stopped", machine: null, notes: ["stopped through the API", "orphan: no bb machine uses it"] },
    ],
  );
  assert.equal(rows[0].type, "small");
  // Printing applies nothing.
  assert.deepEqual([boat.suspended, boat.stopped, boat.touched], [[], [], []]);
});

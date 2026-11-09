import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toSandbox, type Sandbox } from "../boat/sandbox.ts";
import { machineLabels } from "../ownership.ts";
import { planSweep, type HostView, type SweepPolicy } from "./plan.ts";

const CAPTURED = JSON.parse(readFileSync(new URL("../boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;
const NOW = Date.parse("2026-11-08T12:00:00Z");
const MINUTE = 60_000;
const IDLE_15: SweepPolicy = { now: NOW, idleMs: 15 * MINUTE };

/** A sandbox whose auto-stop is `leaseMinutes` away; `wire` overrides boat's JSON. */
function sandbox(leaseMinutes = 120, state = "idle", wire: object = {}): Sandbox {
  const parsed = toSandbox({ ...CAPTURED, state, archiveAfter: new Date(NOW + leaseMinutes * MINUTE).toISOString(), ...wire });
  if (parsed === null) throw new Error("unreachable: the fixture is present");
  return parsed;
}

/** An owned sandbox no machine references, created `minutesAgo` minutes ago. */
function orphan(minutesAgo: number, state = "idle"): Sandbox {
  const labels = machineLabels("owner-1", "thr_gone");
  return sandbox(120, state, { id: "bx_zzzzzzzz", labels, createdAt: new Date(NOW - minutesAgo * MINUTE).toISOString() });
}

function host(view: Partial<HostView> = {}): HostView {
  return { hostId: "host_1", phase: "active", sandboxId: sandbox().id, busy: false, lastActiveAt: NOW - MINUTE, ...view };
}

const planAll = (hosts: HostView[], found: Sandbox[], policy = IDLE_15) =>
  planSweep({ hosts, sandboxes: new Map(found.map((each) => [each.id, each])) }, policy);

const plan = (view: HostView, found: Sandbox | null = sandbox(), policy = IDLE_15) =>
  planAll([view], found === null ? [] : [found], policy);

test("a busy machine is marked active, however long ago it was last touched", () => {
  assert.deepEqual(plan(host({ busy: true, lastActiveAt: NOW - 60 * MINUTE })), [{ kind: "mark-active", hostId: "host_1" }]);
});

test("an idle machine past the limit is suspended", () => {
  assert.deepEqual(plan(host({ lastActiveAt: NOW - 15 * MINUTE })), [{ kind: "suspend-idle", hostId: "host_1" }]);
});

test("an idle machine with its lease due is renewed before it is suspended", () => {
  assert.deepEqual(plan(host({ lastActiveAt: NOW - 15 * MINUTE }), sandbox(10)), [
    { kind: "renew-lease", sandboxId: sandbox().id },
    { kind: "suspend-idle", hostId: "host_1" },
  ]);
});

test("a busy machine gets both its mark and its lease", () => {
  assert.deepEqual(plan(host({ busy: true }), sandbox(10)), [
    { kind: "mark-active", hostId: "host_1" },
    { kind: "renew-lease", sandboxId: sandbox().id },
  ]);
});

test("an idle machine under the limit is left alone", () => {
  assert.deepEqual(plan(host({ lastActiveAt: NOW - 14 * MINUTE })), []);
});

test("a machine never seen before starts its idle clock instead of being suspended", () => {
  assert.deepEqual(plan(host({ lastActiveAt: null })), [{ kind: "mark-active", hostId: "host_1" }]);
});

test("idle minutes 0 never suspends, and still renews the lease", () => {
  const actions = plan(host({ lastActiveAt: NOW - 600 * MINUTE }), sandbox(30), { now: NOW, idleMs: null });
  assert.deepEqual(actions, [{ kind: "renew-lease", sandboxId: sandbox().id }]);
});

test("the lease is renewed once the deadline is under an hour away", () => {
  assert.deepEqual(plan(host(), sandbox(59)), [{ kind: "renew-lease", sandboxId: sandbox().id }]);
});

test("the lease is not renewed while the deadline is an hour or more away", () => {
  assert.deepEqual(plan(host(), sandbox(60)), []);
});

test("a creating, resuming or suspending machine gets the lease, never an idle decision", () => {
  for (const phase of ["creating", "resuming", "suspending"] as const)
    assert.deepEqual(plan(host({ phase, lastActiveAt: NOW - 600 * MINUTE }), sandbox(10)), [
      { kind: "renew-lease", sandboxId: sandbox().id },
    ]);
});

test("a creating, resuming or suspending machine whose sandbox is down or gone is left to core", () => {
  for (const phase of ["creating", "resuming", "suspending"] as const) {
    assert.deepEqual(plan(host({ phase }), sandbox(10, "archiving")), []);
    assert.deepEqual(plan(host({ phase }), sandbox(10, "archived")), []);
    assert.deepEqual(plan(host({ phase }), null), []);
  }
});

test("a machine core is removing or has removed is left alone", () => {
  for (const phase of ["removing", "destroyed"] as const)
    assert.deepEqual(plan(host({ phase, lastActiveAt: NOW - 600 * MINUTE }), sandbox(10)), []);
});

// Drift: active in bb, not awake on boat.

test("an active machine whose sandbox boat stopped by itself is recorded as suspended", () => {
  const stopped = sandbox(10, "archived", { stop: null });
  assert.deepEqual(plan(host({ busy: true }), stopped), [
    { kind: "record-stopped", hostId: "host_1", why: `boat sandbox ${stopped.id} is stopped (stopped by boat)` },
  ]);
});

test("an active machine whose sandbox is stopping, or failed, is recorded as suspended", () => {
  assert.deepEqual(plan(host(), sandbox(10, "archiving")).map(({ kind }) => kind), ["record-stopped"]);
  assert.deepEqual(plan(host(), sandbox(10, "error", { error: "machine lost" })), [
    { kind: "record-stopped", hostId: "host_1", why: `boat sandbox ${sandbox().id} is failed (boat: machine lost)` },
  ]);
});

test("an active machine whose sandbox was deleted outside bb is recorded as suspended", () => {
  assert.deepEqual(plan(host(), null), [
    { kind: "record-stopped", hostId: "host_1", why: `boat sandbox ${sandbox().id} no longer exists` },
  ]);
});

// Drift: suspended in bb.

test("a suspended machine whose sandbox someone resumed is stopped again", () => {
  assert.deepEqual(plan(host({ phase: "suspended" }), sandbox()), [{ kind: "stop-again", hostId: "host_1" }]);
  assert.deepEqual(plan(host({ phase: "suspended" }), sandbox(120, "provisioning")), [{ kind: "stop-again", hostId: "host_1" }]);
});

test("a suspended machine whose sandbox is stopped or stopping is left alone", () => {
  assert.deepEqual(plan(host({ phase: "suspended" }), sandbox(10, "archived")), []);
  assert.deepEqual(plan(host({ phase: "suspended" }), sandbox(10, "archiving")), []);
});

test("a suspended machine whose sandbox is gone or whose disk expired is left to the follow-up", () => {
  const expired = sandbox(10, "archived", { dataExpiredAt: new Date(NOW - MINUTE).toISOString() });
  assert.deepEqual(plan(host({ phase: "suspended" }), null), []);
  assert.deepEqual(plan(host({ phase: "suspended" }), expired), []);
});

// Leaks: owned sandboxes no machine references.

test("an awake orphan older than 15 minutes is stopped, never deleted", () => {
  assert.deepEqual(planAll([], [orphan(15)]), [{ kind: "stop-orphan", sandboxId: orphan(15).id }]);
  assert.deepEqual(planAll([], [orphan(15, "provisioning")]).map(({ kind }) => kind), ["stop-orphan"]);
});

test("an orphan under 15 minutes old is left alone: its create may still be checkpointing", () => {
  assert.deepEqual(planAll([], [orphan(14)]), []);
});

test("a stopped or failed orphan is left alone, however old", () => {
  assert.deepEqual(planAll([], [orphan(600, "archived")]), []);
  assert.deepEqual(planAll([], [orphan(600, "error")]), []);
});

test("a sandbox a machine references is never an orphan", () => {
  const old = orphan(600);
  const owner = host({ phase: "suspending", sandboxId: old.id });
  assert.deepEqual(planAll([owner], [old]).filter(({ kind }) => kind === "stop-orphan"), []);
});

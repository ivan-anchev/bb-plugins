import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toSandbox, type Sandbox } from "../boat/sandbox.ts";
import { planSweep, type HostView, type SweepPolicy } from "./plan.ts";

const CAPTURED = JSON.parse(readFileSync(new URL("../boat/fixtures/create-a.json", import.meta.url), "utf8")).sandbox;
const NOW = Date.parse("2026-11-08T12:00:00Z");
const MINUTE = 60_000;
const IDLE_15: SweepPolicy = { now: NOW, idleMs: 15 * MINUTE };

/** A running sandbox whose auto-stop is `leaseMinutes` away. */
function sandbox(leaseMinutes = 120, state = "idle"): Sandbox {
  const parsed = toSandbox({ ...CAPTURED, state, archiveAfter: new Date(NOW + leaseMinutes * MINUTE).toISOString() });
  if (parsed === null) throw new Error("unreachable: the fixture is present");
  return parsed;
}

function host(view: Partial<HostView> = {}): HostView {
  return { hostId: "host_1", phase: "active", sandboxId: sandbox().id, busy: false, lastActiveAt: NOW - MINUTE, ...view };
}

const plan = (view: HostView, found: Sandbox | null = sandbox(), policy = IDLE_15) =>
  planSweep({ hosts: [view], sandboxes: new Map(found === null ? [] : [[found.id, found]]) }, policy);

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

test("a suspending machine whose sandbox is stopping is left alone", () => {
  assert.deepEqual(plan(host({ phase: "suspending" }), sandbox(10, "archiving")), []);
});

test("a machine core has stopped or is removing is left alone", () => {
  for (const phase of ["suspended", "removing", "destroyed"] as const)
    assert.deepEqual(plan(host({ phase, lastActiveAt: NOW - 600 * MINUTE }), sandbox(10)), []);
});

test("an active machine whose sandbox is not awake is left alone", () => {
  assert.deepEqual(plan(host({ lastActiveAt: NOW - 600 * MINUTE }), sandbox(10, "archived")), []);
  assert.deepEqual(plan(host({ lastActiveAt: NOW - 600 * MINUTE }), null), []);
});

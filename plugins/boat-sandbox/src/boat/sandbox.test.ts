import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toSandbox, type SandboxPhase } from "./sandbox.ts";

// Live captures from the spike (spike/*.json): create and fork responses on boat API v1.
const CAPTURES = ["create-a.json", "create-c.json", "fork.json"] as const;

const captured = (name: string): Record<string, unknown> => {
  const body = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  return body.sandbox;
};

const EXPECTED: Record<string, SandboxPhase | null> = {
  init: "starting",
  provisioning: "starting",
  provisioned: "starting",
  cloning: "starting",
  ready: "running",
  idle: "running",
  running: "running",
  archiving: "stopping",
  archived: "stopped",
  error: "failed",
  cancelled: null,
};

for (const name of CAPTURES) {
  test(`${name}: its wire state maps to a phase`, () => {
    const wire = captured(name);
    const sandbox = toSandbox(wire);
    assert.ok(sandbox !== null);
    assert.equal(sandbox.phase, EXPECTED[String(wire.state)]);
    assert.equal(sandbox.id, wire.id);
    assert.deepEqual(sandbox.labels, { "bb-spike": "1" });
  });
}

test("every wire state maps to a phase or null", () => {
  const wire = captured("create-a.json");
  for (const [state, phase] of Object.entries(EXPECTED)) {
    assert.equal(toSandbox({ ...wire, state })?.phase ?? null, phase, state);
  }
});

test("cancelled is gone even with only id, state and error", () => {
  assert.equal(toSandbox({ id: "bx_a8k84ben", state: "cancelled", error: "provisioning failed" }), null);
});

test("an unknown wire state fails at the boundary", () => {
  assert.throws(() => toSandbox({ ...captured("create-a.json"), state: "hibernating" }));
});

test("timestamps parse to epoch milliseconds", () => {
  const sandbox = toSandbox(captured("create-a.json"));
  assert.equal(sandbox?.createdAt, Date.parse("2026-11-08T17:36:58.907Z"));
  assert.equal(sandbox?.archiveAfter, Date.parse("2026-11-08T18:36:58.787Z"));
  assert.equal(sandbox?.stoppedAt, null);
  assert.equal(sandbox?.dataExpired, false);
});

test("a stop note says who stopped the sandbox", () => {
  const wire = captured("create-a.json");
  assert.equal(toSandbox(wire)?.stopNote, null);
  assert.equal(toSandbox({ ...wire, state: "archived" })?.stopNote, "stopped by boat");
  assert.equal(toSandbox({ ...wire, state: "archived", stop: { id: "stop_1" } })?.stopNote, "stopped through the API");
  assert.equal(toSandbox({ ...wire, state: "error", error: "out of capacity" })?.stopNote, "boat: out of capacity");
});

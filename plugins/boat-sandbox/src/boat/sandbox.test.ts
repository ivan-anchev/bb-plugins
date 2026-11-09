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
  const stopped = { ...wire, state: "archived", stoppedAt: "2026-11-08T21:28:07.781Z" };
  assert.equal(toSandbox(wire)?.stopNote, null);
  assert.equal(toSandbox(stopped)?.stopNote, "stopped by boat");
  // Live 2026-11-08: the API stop record ended 18 ms after the sandbox stopped.
  assert.equal(toSandbox({ ...stopped, stop: { id: "stop_1", endedAt: "2026-11-08T21:28:07.799Z" } })?.stopNote, "stopped through the API");
  assert.equal(toSandbox({ ...wire, state: "error", error: "out of capacity" })?.stopNote, "boat: out of capacity");
});

test("boat's own stop after an earlier API stop is a stop by boat", () => {
  // Live 2026-11-08 (bx_pqzun5yr): bb stopped it at 21:28:07, resumed it, then its auto-stop stopped it
  // at 21:29:05; the sandbox still carried the 21:28:07 stop record.
  const wire = {
    ...captured("create-a.json"),
    state: "archived",
    stoppedAt: "2026-11-08T21:29:05.011Z",
    stop: { id: "stop_84e70caa778516ff", status: "completed", endedAt: "2026-11-08T21:28:07.799Z" },
  };
  assert.equal(toSandbox(wire)?.stopNote, "stopped by boat");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SavedSnapshot } from "./boat/wire.ts";
import { describeLaunch, machineInputs, resolveLaunch, type LaunchChoices } from "./launch.ts";

const snapshot = (name: string, status: SavedSnapshot["status"] = "ready", error: string | null = null): SavedSnapshot => ({
  name,
  status,
  error,
  savedFrom: "small",
  savedAt: "2026-11-09T10:12:00.000Z",
});

const choices = (templates: SavedSnapshot[], template: string | null = null): LaunchChoices => ({
  templates,
  defaults: { template, preset: "default" },
});

const SETTING = " (Settings → boat Sandbox → Default template)";

test("a template name is any boat saved-snapshot name, up to 63 characters", () => {
  assert.ok(machineInputs.safeParse({ template: `a${"-".repeat(62)}` }).success);
  assert.ok(!machineInputs.safeParse({ template: `a${"b".repeat(63)}` }).success);
  assert.ok(!machineInputs.safeParse({ template: "Node-Tools" }).success);
  assert.ok(machineInputs.safeParse({ template: null }).success);
  assert.ok(!machineInputs.safeParse({ image: "node-tools" }).success);
});

test("an unknown template is refused, naming the setting only when the name came from it", () => {
  assert.deepEqual(resolveLaunch({ template: "nope" }, choices([snapshot("node-tools")])), {
    ok: false,
    message: 'No saved snapshot "nope" on this boat account. Run `bb boat templates` to list them.',
  });
  assert.deepEqual(resolveLaunch({}, choices([], "gone")), {
    ok: false,
    message: `No saved snapshot "gone" on this boat account${SETTING}. Run \`bb boat templates\` to list them.`,
  });
});

test("a template boat is still saving, or failed to save, is refused with boat's words", () => {
  assert.deepEqual(resolveLaunch({}, choices([snapshot("node-tools", "saving")], "node-tools")), {
    ok: false,
    message: `Template "node-tools" is still saving on boat${SETTING}. Start the thread once \`bb boat templates\` shows it ready.`,
  });
  const failed = choices([snapshot("node-tools", "failed", "source sandbox was deleted")]);
  assert.deepEqual(resolveLaunch({ template: "node-tools" }, failed), {
    ok: false,
    message: 'boat could not save template "node-tools": source sandbox was deleted. Save it again with `boat snapshot <sandbox-id> node-tools`.',
  });
});

test("a thread's template and size win over the defaults, and null is boat's stock image even with a Default template", () => {
  const ready = choices([snapshot("node-tools"), snapshot("py-ml")], "node-tools");
  assert.deepEqual(resolveLaunch({}, ready), { ok: true, launch: { template: "node-tools", preset: "default" } });
  assert.deepEqual(resolveLaunch({ template: "py-ml", preset: "small" }, ready), { ok: true, launch: { template: "py-ml", preset: "small" } });
  // A stale Default template does not matter when the thread asks for the stock image.
  assert.deepEqual(resolveLaunch({ template: null }, choices([], "gone")), { ok: true, launch: { template: null, preset: "default" } });
});

test("a launch reads as one phrase", () => {
  assert.equal(describeLaunch({ template: "node-tools", preset: "small" }), "a small boat sandbox from template node-tools");
  assert.equal(describeLaunch({ template: null, preset: "xlarge" }), "an xlarge boat sandbox from boat's stock image");
});

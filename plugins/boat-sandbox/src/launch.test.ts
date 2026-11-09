import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxEnvironment, SavedSnapshot } from "./boat/wire.ts";
import { describeLaunch, machineInputs, resolveLaunch, type LaunchChoices, type LaunchDefaults } from "./launch.ts";

const snapshot = (name: string, status: SavedSnapshot["status"] = "ready", error: string | null = null): SavedSnapshot => ({
  name,
  status,
  error,
  savedFrom: "small",
  savedAt: "2026-11-09T10:12:00.000Z",
});

const environment = (name: string, isBoatDefault = false): SandboxEnvironment => ({
  name,
  isBoatDefault,
  withholdsAll: false,
  proxiesAi: false,
  passes: { agents: true, github: true, secrets: true },
  profileId: null,
});

const BASE = environment("base", true);
const QA = environment("qa");

const choices = (templates: SavedSnapshot[], defaults: Partial<LaunchDefaults> = {}): LaunchChoices => ({
  templates,
  environments: [BASE, QA],
  defaults: { template: null, environment: null, preset: "default", ...defaults },
});

const SETTING = " (Settings → boat Sandbox → Default template)";

test("a template name is any boat saved-snapshot name, up to 63 characters", () => {
  assert.ok(machineInputs.safeParse({ template: `a${"-".repeat(62)}` }).success);
  assert.ok(!machineInputs.safeParse({ template: `a${"b".repeat(63)}` }).success);
  assert.ok(!machineInputs.safeParse({ template: "Node-Tools" }).success);
  assert.ok(machineInputs.safeParse({ template: null }).success);
  assert.ok(!machineInputs.safeParse({ image: "node-tools" }).success);
});

test("an environment is named, never null or empty", () => {
  assert.ok(machineInputs.safeParse({ environment: "customer demos" }).success);
  assert.ok(!machineInputs.safeParse({ environment: "" }).success);
  assert.ok(!machineInputs.safeParse({ environment: null }).success);
});

test("an unknown template is refused, naming the setting only when the name came from it", () => {
  assert.deepEqual(resolveLaunch({ template: "nope" }, choices([snapshot("node-tools")])), {
    ok: false,
    message: 'No saved snapshot "nope" on this boat account. Run `bb boat templates` to list them.',
    setting: null,
    name: "nope",
  });
  assert.deepEqual(resolveLaunch({}, choices([], { template: "gone" })), {
    ok: false,
    message: `No saved snapshot "gone" on this boat account${SETTING}. Run \`bb boat templates\` to list them.`,
    setting: "defaultTemplate",
    name: "gone",
  });
});

test("a template boat is still saving, or failed to save, is refused with boat's words", () => {
  assert.deepEqual(resolveLaunch({}, choices([snapshot("node-tools", "saving")], { template: "node-tools" })), {
    ok: false,
    message: `Template "node-tools" is still saving on boat${SETTING}. Start the thread once \`bb boat templates\` shows it ready.`,
    setting: "defaultTemplate",
    name: "node-tools",
  });
  const failed = choices([snapshot("node-tools", "failed", "source sandbox was deleted")]);
  assert.deepEqual(resolveLaunch({ template: "node-tools" }, failed), {
    ok: false,
    message: "boat could not save template \"node-tools\": source sandbox was deleted. Save it again with `boat snapshot <sandbox-id> 'node-tools'`.",
    setting: null,
    name: "node-tools",
  });
});

test("a thread's template and size win over the defaults, and null is boat's stock image even with a Default template", () => {
  const ready = choices([snapshot("node-tools"), snapshot("py-ml")], { template: "node-tools" });
  assert.deepEqual(resolveLaunch({}, ready), { ok: true, launch: { template: "node-tools", environment: "base", preset: "default" }, environment: BASE });
  const picked = resolveLaunch({ template: "py-ml", preset: "small" }, ready);
  assert.deepEqual(picked.ok && picked.launch, { template: "py-ml", environment: "base", preset: "small" });
  // A stale Default template does not matter when the thread asks for the stock image.
  const stock = resolveLaunch({ template: null }, choices([], { template: "gone" }));
  assert.deepEqual(stock.ok && stock.launch, { template: null, environment: "base", preset: "default" });
});

test("the environment is the thread's, else the Default environment, else boat's default", () => {
  const environmentOf = (inputs: { environment?: string }, defaultEnvironment: string | null) => {
    const resolution = resolveLaunch(inputs, choices([], { environment: defaultEnvironment }));
    return resolution.ok ? [resolution.launch.environment, resolution.environment] : resolution.message;
  };
  assert.deepEqual(environmentOf({}, null), ["base", BASE]);
  assert.deepEqual(environmentOf({}, "qa"), ["qa", QA]);
  assert.deepEqual(environmentOf({ environment: "base" }, "qa"), ["base", BASE]);
});

test("an unknown environment is refused, naming the setting only when the name came from it", () => {
  assert.deepEqual(resolveLaunch({ environment: "nope" }, choices([])), {
    ok: false,
    message: 'boat has no environment "nope". Run `bb boat templates` to list them.',
    setting: null,
    name: "nope",
  });
  assert.deepEqual(resolveLaunch({}, choices([], { environment: "gone" })), {
    ok: false,
    message: 'boat has no environment "gone" (Settings → boat Sandbox → Default environment). Run `bb boat templates` to list them.',
    setting: "defaultEnvironment",
    name: "gone",
  });
  // A thread that names an environment does not need the stale default.
  assert.ok(resolveLaunch({ environment: "qa" }, choices([], { environment: "gone" })).ok);
});

test("a launch reads as one phrase", () => {
  assert.equal(
    describeLaunch({ template: "node-tools", environment: "base", preset: "small" }),
    "a small boat sandbox from template node-tools in environment base",
  );
  assert.equal(describeLaunch({ template: null, environment: "qa", preset: "xlarge" }), "an xlarge boat sandbox from boat's stock image in environment qa");
});

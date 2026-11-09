import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSettings, type BoatSettingsValues } from "./settings.ts";

// The values bb hands the plugin on a fresh install: defaults, no secret.
const DEFAULTS: BoatSettingsValues = { apiKey: undefined, idleMinutes: 15, defaultPreset: "default" };

test("no key is a setup problem whose fix names the settings path", () => {
  for (const apiKey of [undefined, "", "   "]) {
    const resolved = resolveSettings({ ...DEFAULTS, apiKey });
    assert.equal(resolved.ok, false);
    assert.ok(!resolved.ok && resolved.problem.fix.includes("Settings → boat Sandbox → API key"));
  }
});

test("a key with the defaults resolves", () => {
  assert.deepEqual(resolveSettings({ ...DEFAULTS, apiKey: " boat_abc \n" }), {
    ok: true,
    apiKey: "boat_abc",
    idleMs: 15 * 60_000,
    defaultPreset: "default",
  });
});

test("0 idle minutes never stops for idleness", () => {
  const resolved = resolveSettings({ ...DEFAULTS, apiKey: "boat_abc", idleMinutes: 0 });
  assert.ok(resolved.ok && resolved.idleMs === null);
});

test("idle minutes outside 0..1440 or fractional are rejected", () => {
  for (const idleMinutes of [-1, 1441, 2.5]) {
    const resolved = resolveSettings({ ...DEFAULTS, apiKey: "boat_abc", idleMinutes });
    assert.ok(!resolved.ok && resolved.problem.message.includes(String(idleMinutes)), String(idleMinutes));
  }
  assert.ok(resolveSettings({ ...DEFAULTS, apiKey: "boat_abc", idleMinutes: 1440 }).ok);
});

test("a size that is not a boat preset is rejected", () => {
  const resolved = resolveSettings({ ...DEFAULTS, apiKey: "boat_abc", defaultPreset: "huge" });
  assert.ok(!resolved.ok && resolved.problem.fix.includes("defaultPreset default"));
  assert.ok(resolveSettings({ ...DEFAULTS, apiKey: "boat_abc", defaultPreset: "xlarge" }).ok);
});

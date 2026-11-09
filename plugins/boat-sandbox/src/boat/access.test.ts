import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { BoatSettingsValues } from "../settings.ts";
import { createBoatAccess, type Configuration } from "./access.ts";

const RELOAD_ENDING = ", then run `bb plugin reload boat-sandbox`.";
const WORKING: BoatSettingsValues = { apiKey: "boat_abc", idleMinutes: 15, defaultPreset: "default", defaultTemplate: "" };
const ME = { user: { id: "sandbox_1", login: "octocat", zeroDataRetention: false } };
const LIMITS = { canStart: true, starts: { unlimited: true } };

afterEach(() => mock.restoreAll());

/** boat answering /me and /limits with these bodies, or failing every request with `failure`. */
function boatAnswers(answers: { me?: unknown; limits?: unknown; status?: number; failure?: Error }) {
  mock.method(globalThis, "fetch", async (url: string) => {
    if (answers.failure) throw answers.failure;
    const body = url.endsWith("/me") ? (answers.me ?? ME) : (answers.limits ?? LIMITS);
    return new Response(JSON.stringify(answers.status ? { code: "unauthorized", message: "no" } : body), {
      status: answers.status ?? 200,
    });
  });
}

const configurationWith = (values: Partial<BoatSettingsValues>): Promise<Configuration> =>
  createBoatAccess({ get: async () => ({ ...WORKING, ...values }) }).configuration();

const fixes = (configuration: Configuration): string[] =>
  configuration.status === "available" ? [] : configuration.problems.map((problem) => problem.fix);

const CASES: Record<string, () => Promise<Configuration>> = {
  "no key": () => configurationWith({ apiKey: undefined }),
  "idle minutes out of range": () => configurationWith({ idleMinutes: -1 }),
  "unknown size": () => configurationWith({ defaultPreset: "huge" }),
  "rejected key": () => (boatAnswers({ status: 401 }), configurationWith({})),
  "boat unreachable": () => (boatAnswers({ failure: new TypeError("fetch failed") }), configurationWith({})),
  "zero data retention": () =>
    (boatAnswers({ me: { user: { ...ME.user, zeroDataRetention: true } } }), configurationWith({})),
  "organization wallet": () => (boatAnswers({ limits: { ...LIMITS, teamId: "team_1" } }), configurationWith({})),
};

// bb sets needs-configuration only at load, so a fix that skips the reload leaves bb showing the problem.
for (const [name, configure] of Object.entries(CASES)) {
  test(`${name}: its fix ends by reloading the plugin`, async () => {
    const found = fixes(await configure());
    assert.equal(found.length, 1);
    for (const fix of found) assert.ok(fix.endsWith(RELOAD_ENDING), fix);
  });
}

test("a working key on a personal wallet has no problems", async () => {
  boatAnswers({});
  assert.equal((await configurationWith({})).status, "available");
});

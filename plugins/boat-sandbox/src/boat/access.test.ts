import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { BoatSettingsValues } from "../settings.ts";
import { createBoatAccess, type Configuration } from "./access.ts";

const RELOAD_ENDING = ", then run `bb plugin reload boat-sandbox`.";
const WORKING: BoatSettingsValues = { apiKey: "boat_abc", idleMinutes: 15, defaultPreset: "default", defaultTemplate: "", defaultEnvironment: "", sidebarIcon: true };
const ME = { user: { id: "sandbox_1", login: "octocat", zeroDataRetention: false, connectionMethods: ["github"] } };
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

interface Case {
  /** The chip blocks submit on a refusal but not on a failed read, so the two never share a status. */
  status: Configuration["status"];
  configure(): Promise<Configuration>;
}

const CASES: Record<string, Case> = {
  "no key": { status: "setup-required", configure: () => configurationWith({ apiKey: undefined }) },
  "idle minutes out of range": { status: "setup-required", configure: () => configurationWith({ idleMinutes: -1 }) },
  "unknown size": { status: "setup-required", configure: () => configurationWith({ defaultPreset: "huge" }) },
  "rejected key": { status: "refused", configure: () => (boatAnswers({ status: 401 }), configurationWith({})) },
  "zero data retention": {
    status: "refused",
    configure: () => (boatAnswers({ me: { user: { ...ME.user, zeroDataRetention: true } } }), configurationWith({})),
  },
  "organization wallet": {
    status: "refused",
    configure: () => (boatAnswers({ limits: { ...LIMITS, teamId: "team_1" } }), configurationWith({})),
  },
  "boat unreachable": { status: "read-failed", configure: () => (boatAnswers({ failure: new TypeError("fetch failed") }), configurationWith({})) },
  "boat failing": { status: "read-failed", configure: () => (boatAnswers({ status: 503 }), configurationWith({})) },
};

for (const [name, { status, configure }] of Object.entries(CASES)) {
  test(`${name}: ${status}`, async () => {
    assert.equal((await configure()).status, status);
  });

  // bb sets needs-configuration only at load, so a fix that skips the reload leaves bb showing the problem.
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

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { BoatAccess, BoatSession, Configuration } from "./boat/access.ts";
import { BoatApiError, type BoatClient } from "./boat/client.ts";
import {
  accountId,
  wireCredentialProfileList,
  wireEnvironmentList,
  wireSavedSnapshotList,
  type SandboxEnvironment,
  type SavedSnapshot,
} from "./boat/wire.ts";
import { boatCli } from "./cli.ts";
import { problem } from "./problem.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./boat/fixtures/${name}`, import.meta.url), "utf8"));

/** tpl-test and tpl-noenv, as boat listed them live (ids redacted). */
const SAVED = wireSavedSnapshotList.parse(fixture("saved-snapshots.json"));
const FAILED: SavedSnapshot = { name: "py-ml", status: "failed", error: "source sandbox was deleted", savedFrom: null, savedAt: "2026-11-09T11:02:00.000Z" };
/** base as boat listed it live, and customer-demos: safe for third parties, with AI proxy placeholders. */
const ENVIRONMENTS = wireEnvironmentList.parse(fixture("environments.json"));
/** The account's default profile, as boat listed it live (owner id redacted): nothing connected, proxy off. */
const PROFILES = wireCredentialProfileList.parse(fixture("credential-profiles.json"));

const unused = () => Promise.reject(new Error("the command never calls this"));

interface Account {
  template?: string | null;
  environment?: string | null;
  environments?: readonly SandboxEnvironment[];
  savedSnapshots?: BoatClient["savedSnapshots"];
  credentialProfiles?: BoatClient["credentialProfiles"];
}

function cliWith({ template = null, environment = null, environments = ENVIRONMENTS, savedSnapshots, credentialProfiles }: Account = {}) {
  const client: BoatClient = {
    savedSnapshots: savedSnapshots ?? (async () => [...SAVED, FAILED]),
    environments: async () => [...environments],
    credentialProfiles: credentialProfiles ?? (async () => PROFILES),
    me: unused,
    limits: unused,
    get: unused,
    list: unused,
    create: unused,
    remove: unused,
    stop: unused,
    resume: unused,
    setTtl: unused,
    run: unused,
    writeFile: unused,
  };
  const session: BoatSession = {
    status: "available",
    facts: {
      account: { id: accountId.parse("sandbox_1"), login: "octocat", zeroDataRetention: false },
      limits: { wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null },
    },
    client,
    settings: { ok: true, apiKey: "boat_test", idleMs: null, defaults: { template, environment, preset: "default" } },
  };
  return cli({ configuration: async () => session, session: async () => session });
}

const cli = (access: BoatAccess) =>
  boatCli(access, { bb: { sdk: { hosts: { list: unused }, threads: { count: unused } }, experimental_machines: { getResource: unused } }, idle: { read: unused }, ownerId: "owner-1" });

test("bb boat templates lists every template and environment with its --machine-inputs, and the default launch", async () => {
  const { exitCode, stdout } = await cliWith({ template: "tpl-test" }).run(["templates"], {});

  assert.equal(exitCode, 0);
  assert.equal(
    stdout,
    [
      "TEMPLATE          STATUS  SIZE   SAVED              --machine-inputs            NOTES",
      "boat stock image  ready   -      -                  '{\"template\":null}'",
      "tpl-test          ready   small  2026-11-09T09:50Z  '{\"template\":\"tpl-test\"}'   default",
      "tpl-noenv         ready   small  2026-11-09T09:49Z  '{\"template\":\"tpl-noenv\"}'",
      "py-ml             failed  -      2026-11-09T11:02Z  -                           source sandbox was deleted",
      "",
      "ENVIRONMENT     PASSES                                               --machine-inputs                    NOTES",
      "base            agents, GitHub, secrets                              '{\"environment\":\"base\"}'            boat's default; default",
      "customer-demos  AI proxy placeholders only (safe for third parties)  '{\"environment\":\"customer-demos\"}'",
      "",
      "Default launch (Settings → boat Sandbox): a default boat sandbox from template tpl-test in environment base.",
      "  bb thread spawn --project <project-id> --environment-provider boat-sandbox \\",
      `    --machine-inputs '{"template":"tpl-test","environment":"base","preset":"default"}' --prompt "…"`,
      "Save a template from any boat sandbox with: boat snapshot <sandbox-id> <name>",
      "",
    ].join("\n"),
  );
});

test("bb boat templates marks the Default environment, and says when the default launch is refused", async () => {
  const named = await cliWith({ environment: "customer-demos" }).run(["templates"], {});
  assert.match(named.stdout ?? "", /\ncustomer-demos .*'\{"environment":"customer-demos"\}'\s+default\n/);
  assert.match(named.stdout ?? "", /--machine-inputs '\{"template":null,"environment":"customer-demos","preset":"default"\}'/);

  const stale = await cliWith({ environment: "nope" }).run(["templates"], {});
  assert.equal(stale.exitCode, 0);
  assert.match(
    stale.stdout ?? "",
    /\nDefault launch \(Settings → boat Sandbox\) is refused: boat has no environment "nope" \(Settings → boat Sandbox → Default environment\)\./,
  );
});

/** boat environment names are free text: a space, an apostrophe and a `$` a shell would expand. */
const ODD_NAME = "Bob's demos $HOME";
const ODD: SandboxEnvironment = {
  name: ODD_NAME,
  isBoatDefault: false,
  withholdsAll: false,
  proxiesAi: false,
  passes: { agents: false, github: true, secrets: true },
  profileId: null,
};

/** The words sh reads from a printed command: `bb`, `boat` and the rest as sh would pass them. */
const shellWords = (command: string): string[] =>
  execFileSync("sh", ["-c", `printf '%s\\0' ${command}`], { encoding: "utf8" }).split("\0").slice(0, -1);

test("bb boat templates prints --machine-inputs a shell passes unchanged, for an environment name with a space, an apostrophe and a $", async () => {
  const { stdout = "" } = await cliWith({ environment: ODD_NAME, environments: [...ENVIRONMENTS, ODD] }).run(["templates"], {});

  assert.ok(stdout.includes(String.raw`'{"environment":"Bob'\''s demos $HOME"}'`), stdout);
  const spawn = /\n {2}(bb thread spawn .*\\\n.*)\n/.exec(stdout)?.[1] ?? "";
  const words = shellWords(spawn.replace("<project-id>", "proj_1"));
  assert.equal(words[0], "bb");
  assert.deepEqual(JSON.parse(words[words.indexOf("--machine-inputs") + 1] ?? ""), { template: null, environment: ODD_NAME, preset: "default" });
});

test("bb boat templates --json prints the launch choices", async () => {
  const { stdout } = await cliWith().run(["templates", "--json"], {});

  assert.deepEqual(JSON.parse(stdout ?? ""), {
    templates: [...SAVED, FAILED],
    environments: ENVIRONMENTS,
    defaults: { template: null, environment: null, preset: "default" },
  });
});

test("bb boat templates exits 1 with the status problem lines when the key does not work", async () => {
  const missing: Configuration = { status: "setup-required", facts: null, problems: [problem("No boat API key is set.", "Paste one")] };
  const access: BoatAccess = { configuration: async () => missing, session: unused };

  const { exitCode, stdout } = await cli(access).run(["templates"], {});

  assert.equal(exitCode, 1);
  assert.equal(stdout, "No boat API key is set.\nFix: Paste one, then run `bb plugin reload boat-sandbox`.\n");
});

/** The status lines after the five key facts. */
async function statusAfterFacts(account: Account) {
  const { exitCode, stdout } = await cliWith(account).run(["status"], {});
  return { exitCode, lines: (stdout ?? "").trimEnd().split("\n").slice(5) };
}

test("bb boat status names the default launch's environment and what it signs in, and no boat CLI token row", async () => {
  const connected = PROFILES.map((profile) => ({ ...profile, connected: ["claude-subscription"], proxyOn: true }));

  assert.deepEqual(await statusAfterFacts({ template: "tpl-test", credentialProfiles: async () => connected }), {
    exitCode: 0,
    lines: [
      "Default launch: a default boat sandbox from template tpl-test in environment base (boat's default environment)",
      "Claude Code: connected on boat (claude-subscription)",
      "Codex: not connected on boat",
      "Fix: Sign in to ChatGPT, or add an OpenAI API key, on https://boat.dev/dashboard?tab=agents",
      "AI proxy: on for your boat account ($1 a day plus $1 per 1,000 requests)",
    ],
  });
});

test("bb boat status reads an environment safe for third parties with proxy placeholders as signed in through the proxy", async () => {
  assert.deepEqual(await statusAfterFacts({ environment: "customer-demos" }), {
    exitCode: 0,
    lines: [
      "Default launch: a default boat sandbox from boat's stock image in environment customer-demos",
      "Claude Code: through boat's AI proxy (environment customer-demos passes placeholders)",
      "Codex: through boat's AI proxy (environment customer-demos passes placeholders)",
      "AI proxy: off for your boat account",
    ],
  });
});

test("bb boat status prints a boat env set fix a shell passes unchanged, for an environment name with a space, an apostrophe and a $", async () => {
  const { lines } = await statusAfterFacts({ environment: ODD_NAME, environments: [...ENVIRONMENTS, ODD] });

  const fix = lines.find((line) => line.startsWith("Fix: Run `boat env set")) ?? "";
  assert.equal(fix, "Fix: Run `boat env set 'Bob'\\''s demos $HOME' --agents-credentials true`");
  assert.deepEqual(shellWords(fix.slice("Fix: Run `".length, -1)), ["boat", "env", "set", ODD_NAME, "--agents-credentials", "true"]);
});

test("bb boat status leaves the sign-in rows unknown when the key lacks account.admin, and still exits 0", async () => {
  const forbidden = () => Promise.reject(new BoatApiError(403, "api_key_action_forbidden", "This API key cannot account.admin.", null, false));
  const reason = "unknown (the API key lacks boat's account.admin scope; `boat ai profiles` shows it)";

  assert.deepEqual(await statusAfterFacts({ credentialProfiles: forbidden }), {
    exitCode: 0,
    lines: [
      "Default launch: a default boat sandbox from boat's stock image in environment base (boat's default environment)",
      `Claude Code: ${reason}`,
      `Codex: ${reason}`,
      `AI proxy: ${reason}`,
    ],
  });
});

test("bb boat status refuses a Default template or Default environment boat does not have, with the fix for that setting", async () => {
  const template = await statusAfterFacts({ template: "gone" });
  assert.equal(template.exitCode, 0);
  assert.equal(template.lines[0], 'Default launch: refused: No saved snapshot "gone" on this boat account (Settings → boat Sandbox → Default template). Run `bb boat templates` to list them.');
  assert.match(template.lines[1] ?? "", /^Fix: Run `bb plugin config boat-sandbox set defaultTemplate <name>`.*unset defaultTemplate/);

  const environment = await statusAfterFacts({ environment: "nope" });
  assert.deepEqual(environment, {
    exitCode: 0,
    lines: [
      'Default launch: refused: boat has no environment "nope" (Settings → boat Sandbox → Default environment). Run `bb boat templates` to list them.',
      "Fix: Run `bb plugin config boat-sandbox set defaultEnvironment <name>` with an environment `bb boat templates` lists, " +
        "or `bb plugin config boat-sandbox unset defaultEnvironment` for boat's default environment.",
    ],
  });
});

test("bb boat status reads the default launch and its sign-ins as unknown when boat cannot list the choices", async () => {
  const { exitCode, lines } = await statusAfterFacts({ savedSnapshots: async () => Promise.reject(new Error("boat is down for maintenance.")) });

  assert.deepEqual({ exitCode, lines }, {
    exitCode: 0,
    lines: ["Default launch", "Claude Code", "Codex", "AI proxy"].map((row) => `${row}: unknown (boat is down for maintenance.)`),
  });
});

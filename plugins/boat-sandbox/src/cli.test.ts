import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";
import { createBoatAccess, type BoatAccess, type BoatSession, type Configuration } from "./boat/access.ts";
import { BoatApiError, type BoatClient } from "./boat/client.ts";
import {
  accountId,
  wireCredentialProfileList,
  wireEnvironmentList,
  wireGithubApp,
  wireSavedSnapshotList,
  type SandboxEnvironment,
  type SavedSnapshot,
} from "./boat/wire.ts";
import { launchRpcHandlers } from "./catalog/read.ts";
import { boatCli } from "./cli.ts";
import { problem } from "./problem.ts";
import type { StatusDeps } from "./status.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./boat/fixtures/${name}`, import.meta.url), "utf8"));

/** tpl-test and tpl-noenv, as boat listed them live (ids redacted). */
const SAVED = wireSavedSnapshotList.parse(fixture("saved-snapshots.json"));
const FAILED: SavedSnapshot = { name: "py-ml", status: "failed", error: "source sandbox was deleted", savedFrom: null, savedAt: "2026-11-09T11:02:00.000Z" };
/** base as boat listed it live, and customer-demos: safe for third parties, with AI proxy placeholders. */
const ENVIRONMENTS = wireEnvironmentList.parse(fixture("environments.json"));
/** The account's default profile, as boat listed it live (owner id redacted): nothing connected, proxy off. */
const PROFILES = wireCredentialProfileList.parse(fixture("credential-profiles.json"));
/** boat's GitHub App installed for octocat, in OAS `ReposResponse` shape (an account without the App reads `installations: []`). */
const GITHUB_APP = wireGithubApp.parse(fixture("repos.json"));

const unused = () => Promise.reject(new Error("the command never calls this"));

interface Account {
  template?: string | null;
  environment?: string | null;
  environments?: readonly SandboxEnvironment[];
  savedSnapshots?: BoatClient["savedSnapshots"];
  credentialProfiles?: BoatClient["credentialProfiles"];
  githubApp?: BoatClient["githubApp"];
  githubLinked?: boolean;
  /** bb's forwarded GitHub login; a string is bb's `builtInGit.status`. */
  bbGithub?: BuiltInGitStatus | (() => Promise<never>);
}

type BuiltInGitStatus = Awaited<ReturnType<StatusDeps["machineEnvironment"]>>["builtInGit"]["status"];

function cliWith(account: Account = {}) {
  const { access, machineEnvironment } = accountWith(account);
  return cli(access, machineEnvironment);
}

function accountWith(account: Account): { access: BoatAccess; machineEnvironment: StatusDeps["machineEnvironment"] } {
  const { template = null, environment = null, environments = ENVIRONMENTS, savedSnapshots, credentialProfiles, githubApp, githubLinked = true, bbGithub = "logged in" } = account;
  const client: BoatClient = {
    savedSnapshots: savedSnapshots ?? (async () => [...SAVED, FAILED]),
    environments: async () => [...environments],
    credentialProfiles: credentialProfiles ?? (async () => PROFILES),
    githubApp: githubApp ?? (async () => GITHUB_APP),
    me: unused,
    limits: unused,
    get: unused,
    list: unused,
    meter: unused,
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
      account: { id: accountId.parse("sandbox_1"), login: "octocat", zeroDataRetention: false, githubLinked },
      limits: { wallet: { kind: "personal" }, starts: { unlimited: true }, startsBlockedBy: null, billing: null },
    },
    client,
    settings: { ok: true, apiKey: "boat_test", idleMs: null, defaults: { template, environment, preset: "default" } },
  };
  const machineEnvironment = typeof bbGithub === "string"
    ? async () => ({ builtInGit: { status: bbGithub, statusMessage: "" }, variables: [] })
    : bbGithub;
  return { access: { configuration: async () => session, session: async () => session }, machineEnvironment };
}

const cli = (boat: BoatAccess, machineEnvironment: StatusDeps["machineEnvironment"] = unused) =>
  boatCli({ boat, machineEnvironment }, { bb: { sdk: { hosts: { list: unused }, threads: { listRunning: unused } }, experimental_machines: { getResource: unused } }, idle: { read: unused }, ownerId: "owner-1" });

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

test("bb boat templates --json prints the launch choices, as the composer chip receives them", async () => {
  const { stdout } = await cliWith().run(["templates", "--json"], {});

  assert.deepEqual(JSON.parse(stdout ?? ""), {
    status: "ready",
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

test("bb boat templates --json prints the chip's unavailable reply, and exits 1, when the key does not work", async () => {
  const missing: Configuration = { status: "setup-required", facts: null, problems: [problem("No boat API key is set.", "Paste one")] };
  const access: BoatAccess = { configuration: async () => missing, session: unused };

  const { exitCode, stdout } = await cli(access).run(["templates", "--json"], {});

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stdout ?? ""), {
    status: "unavailable",
    message: "No boat API key is set. Paste one, then run `bb plugin reload boat-sandbox`.",
  });
});

test("the chip's launchChoices RPC returns exactly what bb boat templates --json prints", async () => {
  const { access, machineEnvironment } = accountWith({ template: "tpl-test" });
  const { stdout } = await cli(access, machineEnvironment).run(["templates", "--json"], {});

  const reply = await launchChoicesRpc(access);

  assert.deepEqual(JSON.parse(stdout ?? ""), JSON.parse(JSON.stringify(reply)));
});

const launchChoicesRpc = async (access: BoatAccess) =>
  launchRpcHandlers(access).launchChoices({}, { experimental_signal: new AbortController().signal, experimental_caller: { kind: "client" } });

afterEach(() => mock.restoreAll());

/** The plugin's own access to a boat whose /me and /limits answer every request with `answer`. */
function accessToBoat(answer: { status: number } | { failure: Error }): BoatAccess {
  mock.method(globalThis, "fetch", async () => {
    if ("failure" in answer) throw answer.failure;
    return new Response(JSON.stringify({ code: "unauthorized", message: "no" }), { status: answer.status });
  });
  return createBoatAccess({ get: async () => ({ apiKey: "boat_abc", idleMinutes: 15, defaultPreset: "default", defaultTemplate: "", defaultEnvironment: "", sidebarIcon: true }) });
}

// The chip blocks submit on an `unavailable` reply and never on a thrown read.
test("a failed read of boat's account is no refusal: the chip's RPC and bb boat templates --json both throw it", async () => {
  for (const answer of [{ failure: new TypeError("fetch failed") }, { status: 503 }]) {
    const access = accessToBoat(answer);
    const thrown = { message: /^Could not read the boat account: / };

    await assert.rejects(launchChoicesRpc(access), thrown);
    await assert.rejects(async () => cli(access).run(["templates", "--json"], {}), thrown);
    mock.restoreAll();
  }
});

test("boat rejecting the key is a refusal: the chip's RPC returns the unavailable reply bb boat templates --json prints", async () => {
  const access = accessToBoat({ status: 401 });

  const { exitCode, stdout } = await cli(access).run(["templates", "--json"], {});

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stdout ?? ""), {
    status: "unavailable",
    message: "boat rejected the API key (401 unauthorized). Paste a key from `boat api-key create bb --preset ci` into Settings → boat Sandbox → API key, then run `bb plugin reload boat-sandbox`.",
  });
  assert.deepEqual(JSON.parse(stdout ?? ""), await launchChoicesRpc(access));
});

test("a failed list read throws from the chip's RPC and bb boat templates --json alike", async () => {
  const { access } = accountWith({ savedSnapshots: () => Promise.reject(new Error("boat is down for maintenance.")) });

  await assert.rejects(launchChoicesRpc(access), { message: "boat is down for maintenance." });
  await assert.rejects(async () => cli(access).run(["templates", "--json"], {}), { message: "boat is down for maintenance." });
});

/** The GitHub rows while bb forwards the bb server's gh login. */
const BB_FORWARDED = [
  "GitHub: bb's forwarded login (gh on the bb server), on every bb machine, clone included",
  "To use boat's GitHub token instead, turn off bb's automatic GH_TOKEN: `bb settings general machineGitCredentialsEnabled false`",
];

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
      ...BB_FORWARDED,
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
      ...BB_FORWARDED,
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
      ...BB_FORWARDED,
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
      ...BB_FORWARDED,
    ],
  });
});

test("bb boat status reads the default launch and its sign-ins as unknown when boat cannot list the choices", async () => {
  const { exitCode, lines } = await statusAfterFacts({ savedSnapshots: async () => Promise.reject(new Error("boat is down for maintenance.")) });

  assert.deepEqual({ exitCode, lines }, {
    exitCode: 0,
    lines: [...["Default launch", "Claude Code", "Codex", "AI proxy"].map((row) => `${row}: unknown (boat is down for maintenance.)`), ...BB_FORWARDED],
  });
});

/** The GitHub rows of `bb boat status`: everything after the AI proxy row. */
async function githubRows(account: Account) {
  const { exitCode, lines } = await statusAfterFacts(account);
  return { exitCode, rows: lines.slice(lines.findIndex((line) => line.startsWith("AI proxy:")) + 1) };
}

const BOAT_HEAD = "GitHub: boat's token from environment base (bb forwards no GitHub login:";

test("bb boat status names bb's forwarded login or bb's machine-env GH_TOKEN when bb sends one", async () => {
  assert.deepEqual(await githubRows({ bbGithub: "logged in" }), { exitCode: 0, rows: BB_FORWARDED });
  assert.deepEqual(await githubRows({ bbGithub: "overridden" }), {
    exitCode: 0,
    rows: ["GitHub: the GH_TOKEN in bb's machine environment, which wins over boat's"],
  });
});

test("bb boat status names boat's token, why bb sends none, and who boat's GitHub App is installed for", async () => {
  assert.deepEqual(await githubRows({ bbGithub: "disabled" }), {
    exitCode: 0,
    rows: [`${BOAT_HEAD} bb's automatic GH_TOKEN is off)`, "boat GitHub App: installed for octocat"],
  });
  assert.deepEqual((await githubRows({ bbGithub: "not logged in" })).rows[0], `${BOAT_HEAD} gh on the bb server is not logged in)`);
});

test("bb boat status gives each gap on boat's GitHub path its fix", async () => {
  const connect = "Fix: Click Connect GitHub on https://boat.dev/dashboard?tab=environment";
  const head = `${BOAT_HEAD} bb's automatic GH_TOKEN is off)`;

  const notInstalled = [
    "boat GitHub App: not installed, so boat's token can read public repositories and push to none",
    `${connect}, and install the app for the owners of your repositories`,
  ];
  assert.deepEqual((await githubRows({ bbGithub: "disabled", githubApp: async () => ({ owners: [] }) })).rows, [head, ...notInstalled]);
  const withheld = { ...ODD, passes: { ...ODD.passes, github: false } };
  const { rows } = await githubRows({ bbGithub: "disabled", environment: ODD_NAME, environments: [...ENVIRONMENTS, withheld] });
  assert.deepEqual(rows.slice(1, 3), [`Environment ${ODD_NAME} does not pass GitHub`, "Fix: Run `boat env set 'Bob'\\''s demos $HOME' --github true`"]);
  assert.deepEqual(shellWords(rows[2]?.slice("Fix: Run `".length, -1) ?? ""), ["boat", "env", "set", ODD_NAME, "--github", "true"]);

  const safe = await githubRows({ bbGithub: "disabled", environment: "customer-demos" });
  assert.equal(safe.rows[2], "Fix: Run `boat env set 'customer-demos' --safe-for-third-parties false --github true`");
});

test("bb boat status lists every gap on boat's GitHub path at once: the account link, the environment and the App", async () => {
  const withheld = { ...ODD, passes: { ...ODD.passes, github: false } };
  const { rows } = await githubRows({
    bbGithub: "disabled",
    githubLinked: false,
    environment: ODD_NAME,
    environments: [...ENVIRONMENTS, withheld],
    githubApp: async () => ({ owners: [] }),
  });

  assert.deepEqual(rows, [
    `GitHub: boat's token from environment ${ODD_NAME} (bb forwards no GitHub login: bb's automatic GH_TOKEN is off)`,
    "boat account: not linked to GitHub",
    "Fix: Click Connect GitHub on https://boat.dev/dashboard?tab=environment",
    `Environment ${ODD_NAME} does not pass GitHub`,
    "Fix: Run `boat env set 'Bob'\\''s demos $HOME' --github true`",
    "boat GitHub App: not installed, so boat's token can read public repositories and push to none",
    "Fix: Click Connect GitHub on https://boat.dev/dashboard?tab=environment, and install the app for the owners of your repositories",
  ]);
});

test("bb boat status words a refused GET /repos in boat's words, and an expired key as expired", async () => {
  const refusal = (code: string) => async () => Promise.reject(new BoatApiError(403, code, "This API key cannot use repos.read.", null, false));

  const forbidden = await githubRows({ bbGithub: "disabled", githubApp: refusal("api_key_action_forbidden") });
  assert.deepEqual(forbidden, { exitCode: 0, rows: [`${BOAT_HEAD} bb's automatic GH_TOKEN is off)`, "boat GitHub App: unknown (This API key cannot use repos.read.)"] });

  const expired = await githubRows({ bbGithub: "disabled", githubApp: refusal("api_key_expired") });
  assert.equal(expired.rows[1], "boat GitHub App: unknown (the API key has expired)");
});

test("bb boat status reads GitHub as unknown in bb's words when bb's machine environment cannot be read, and prints the boat rows", async () => {
  const { exitCode, lines } = await statusAfterFacts({ bbGithub: () => Promise.reject(new Error("bb is restarting.")) });

  assert.equal(exitCode, 0);
  assert.equal(lines[0], "Default launch: a default boat sandbox from boat's stock image in environment base (boat's default environment)");
  assert.equal(lines.at(-1), "GitHub: unknown (bb is restarting.)");
});

test("bb boat status reads a GitHub login state newer than this plugin as unknown, on one line", async () => {
  const { exitCode, rows } = await githubRows({ bbGithub: "forwarded by bb cloud" as BuiltInGitStatus });

  assert.deepEqual({ exitCode, rows }, { exitCode: 0, rows: ['GitHub: unknown (bb reports its GitHub login as "forwarded by bb cloud", which this plugin does not know)'] });
});

test("bb boat status still names boat's token when the default launch's environment cannot be told", async () => {
  const { lines } = await statusAfterFacts({ bbGithub: "disabled", environment: "nope" });

  assert.deepEqual(lines.slice(-2), [
    "GitHub: boat's token (bb forwards no GitHub login: bb's automatic GH_TOKEN is off); whether boat passes it is unknown (the default launch is refused)",
    "boat GitHub App: installed for octocat",
  ]);
});

test("bb boat status still names an unlinked boat account and the App when boat's environments cannot be read", async () => {
  const { lines } = await statusAfterFacts({
    bbGithub: "disabled",
    githubLinked: false,
    savedSnapshots: () => Promise.reject(new Error("boat is down for maintenance.")),
  });

  assert.deepEqual(lines.slice(-4), [
    "GitHub: boat's token (bb forwards no GitHub login: bb's automatic GH_TOKEN is off); whether boat passes it is unknown (boat is down for maintenance.)",
    "boat account: not linked to GitHub",
    "Fix: Click Connect GitHub on https://boat.dev/dashboard?tab=environment",
    "boat GitHub App: installed for octocat",
  ]);
});

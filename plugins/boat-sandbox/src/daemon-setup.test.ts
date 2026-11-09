import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BoatClient } from "./boat/client.ts";
import { sandboxId } from "./boat/wire.ts";
import { prepareDaemon } from "./daemon-setup.ts";

const SANDBOX = sandboxId.parse("bx_abcdefgh");
const DROP_IN = ".config/systemd/user/bb-host-daemon-.service.d/boat.conf";

/** Runs prepareDaemon's command as boat would, in a shell, in a scratch HOME; returns that HOME. */
async function preparedHome(): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "bb-boat-daemon-"));
  const sandbox: Pick<BoatClient, "run"> = {
    async run(_id, { command }) {
      const ran = spawnSync("sh", ["-c", command], { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
      return { exitCode: ran.status ?? 1 };
    },
  };
  await prepareDaemon(sandbox, SANDBOX, AbortSignal.timeout(10_000));
  return home;
}

/**
 * The variables systemd gives the daemon from the drop-in's `Environment=` lines. Each word is
 * `NAME=value`, bare, in double quotes or in single quotes; systemd expands no `$NAME` in them.
 */
function environmentOf(dropIn: string): Record<string, string> {
  const words = dropIn
    .split("\n")
    .filter((line) => line.startsWith("Environment="))
    .flatMap((line) => [...line.slice("Environment=".length).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? ""));
  return Object.fromEntries(words.map((word) => [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)]));
}

/** Runs real git with the daemon's environment from the drop-in, as a turn on the sandbox would. */
const git = (environment: Record<string, string>, args: string[], input = "") =>
  spawnSync("git", args, {
    env: { ...environment, HOME: mkdtempSync(join(tmpdir(), "bb-boat-git-")), PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_TERMINAL_PROMPT: "0" },
    input,
    encoding: "utf8",
  });

test("the drop-in loads boat's sign-ins and sets core's four GitHub git settings, with no token in it", async () => {
  const dropIn = readFileSync(join(await preparedHome(), DROP_IN), "utf8");
  const environment = environmentOf(dropIn);

  assert.match(dropIn, /^EnvironmentFile=-%t\/boat-sign-ins\.env$/m);
  assert.deepEqual(environment, {
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
    GIT_CONFIG_VALUE_1: String.raw`!f() { test "$1" = get || return 0; test -n "$GITHUB_TOKEN" || return 0; echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f`,
    GIT_CONFIG_KEY_2: "url.https://github.com/.insteadOf",
    GIT_CONFIG_VALUE_2: "git@github.com:",
    GIT_CONFIG_KEY_3: "url.https://github.com/.insteadOf",
    GIT_CONFIG_VALUE_3: "ssh://git@github.com/",
  });
  // systemd would expand a `%` specifier, and no value may hold a token.
  assert.doesNotMatch(Object.values(environment).join("\n"), /%|gh[upos]_|github_pat_|GITHUB_TOKEN=/);
});

test("with the drop-in's environment, git rewrites SSH GitHub remotes to HTTPS and answers with boat's GITHUB_TOKEN", async () => {
  const environment = environmentOf(readFileSync(join(await preparedHome(), DROP_IN), "utf8"));

  for (const remote of ["git@github.com:octocat/hello.git", "ssh://git@github.com/octocat/hello.git"])
    assert.equal(git(environment, ["ls-remote", "--get-url", remote]).stdout, "https://github.com/octocat/hello.git\n");

  const fill = git({ ...environment, GITHUB_TOKEN: "test-token" }, ["credential", "fill"], "protocol=https\nhost=github.com\n\n");
  assert.match(fill.stdout, /^username=x-access-token\npassword=test-token$/m);

  // Without boat's token the helper answers nothing, so git asks no one and fails as it would with no helper.
  assert.notEqual(git(environment, ["credential", "fill"], "protocol=https\nhost=github.com\n\n").status, 0);
});

test("a drop-in that cannot be written fails with the sandbox named", async () => {
  const failing: Pick<BoatClient, "run"> = { run: async () => ({ exitCode: 1 }) };

  await assert.rejects(prepareDaemon(failing, SANDBOX, AbortSignal.timeout(10_000)), {
    message: `Could not set up bb's daemon for boat's sign-ins and GitHub on sandbox ${SANDBOX} (exit 1).`,
  });
});

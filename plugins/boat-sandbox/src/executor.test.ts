import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";
import type { MachineExecutorRequest } from "@get-bb/plugin-sdk";
import type { CommandRequest } from "./boat/client.ts";
import { sandboxId } from "./boat/wire.ts";
import { boatExecutor } from "./executor.ts";

const SANDBOX = sandboxId.parse("bx_a8k84ben");
const SECRET = "bbde_0123456789abcdef";
// The shape core sends on first enrollment: a JSON bundle whose headers carry the enrollment secret.
const ENROLLMENT = JSON.stringify({ serverUrl: "https://bb.example", headers: { "X-BB-Enrollment": SECRET } });

/** A sandbox that is this machine: commands run in bash, files land on the local disk. */
function localSandbox(options: { failWrite?: boolean } = {}) {
  const commands: CommandRequest[] = [];
  const written: string[] = [];
  const client = {
    async run(_id: unknown, request: CommandRequest) {
      commands.push(request);
      const result = spawnSync("bash", ["-c", request.command], { encoding: "utf8" });
      request.onOutput(result.stdout + result.stderr);
      return { exitCode: result.status ?? 1 };
    },
    async writeFile(_id: unknown, path: string, content: string) {
      written.push(path);
      if (options.failWrite) throw new Error("boat refused the write");
      writeFileSync(path, content);
    },
  };
  return { executor: boatExecutor(client, SANDBOX), commands, written };
}

async function exec(executor: ReturnType<typeof localSandbox>["executor"], request: Partial<MachineExecutorRequest>) {
  let output = "";
  const { exitCode } = await executor.exec({
    command: [],
    stdin: "",
    timeoutMs: 1_000,
    signal: AbortSignal.timeout(10_000),
    onOutput: (chunk) => (output += chunk),
    ...request,
  });
  return { exitCode, output };
}

// Words that break naive quoting: spaces, a single quote, a newline, a variable, an empty word.
const AWKWARD = ["a b", "it's", "multi\nline", "$HOME", ""];
const PRINT_STDIN_AND_ARGS = ["sh", "-c", `cat; printf '<%s>' "$@"`, "bb-test", ...AWKWARD];

test("stdin reaches the command through a file, never through command text", async () => {
  const { executor, commands, written } = localSandbox();
  const { exitCode, output } = await exec(executor, { command: PRINT_STDIN_AND_ARGS, stdin: ENROLLMENT });

  assert.equal(exitCode, 0);
  assert.equal(output, `${ENROLLMENT}${AWKWARD.map((word) => `<${word}>`).join("")}`);
  for (const { command } of commands) {
    assert.ok(!command.includes(SECRET), command);
    assert.ok(!command.includes(ENROLLMENT), command);
  }
  assert.equal(written.length, 1);
  assert.equal(existsSync(dirname(written[0] ?? "")), false, "the command deletes the stdin directory");
});

test("argv round-trips through quoting without stdin", async () => {
  const { executor, written } = localSandbox();
  const { output } = await exec(executor, { command: PRINT_STDIN_AND_ARGS });

  assert.equal(output, AWKWARD.map((word) => `<${word}>`).join(""));
  assert.deepEqual(written, []);
});

test("the stdin directory is private and removed when staging fails", async () => {
  const { executor, commands, written } = localSandbox({ failWrite: true });
  await assert.rejects(exec(executor, { command: ["cat"], stdin: ENROLLMENT }), /boat refused the write/);

  assert.match(commands[0]?.command ?? "", /^umask 077 && mkdir \/tmp\/bb-stdin\.[0-9a-f-]+$/);
  assert.equal(existsSync(dirname(written[0] ?? "")), false);
});

test("timeouts are whole seconds within boat's 600 s ceiling", async () => {
  const { executor, commands } = localSandbox();
  await exec(executor, { command: ["true"], timeoutMs: 1_500 });
  await exec(executor, { command: ["true"], timeoutMs: 3_600_000 });

  assert.deepEqual(commands.map((command) => command.timeoutSeconds), [2, 600]);
});

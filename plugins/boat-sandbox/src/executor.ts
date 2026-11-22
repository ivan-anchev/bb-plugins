import { randomUUID } from "node:crypto";
import type { MachineExecutor } from "@get-bb/plugin-sdk";
import type { BoatClient } from "./boat/client.ts";
import type { SandboxId } from "./boat/sandbox.ts";
import { shellQuoteArgv } from "./shell.ts";

const BOAT_MAX_TIMEOUT_SECONDS = 600;
const CLEANUP_TIMEOUT_MS = 30_000;

type CommandChannel = Pick<BoatClient, "run" | "writeFile">;

export function boatExecutor(client: CommandChannel, sandboxId: SandboxId): MachineExecutor {
  return {
    async exec({ command, stdin, timeoutMs, signal, onOutput }) {
      const timeoutSeconds = Math.min(BOAT_MAX_TIMEOUT_SECONDS, Math.max(1, Math.ceil(timeoutMs / 1000)));
      const run = (text: string) => client.run(sandboxId, { command: text, timeoutSeconds, signal, onOutput });
      if (stdin === "") return run(`exec ${shellQuoteArgv(command)} </dev/null`);

      const dir = `/tmp/bb-stdin.${randomUUID()}`;
      await expectSuccess(run(`umask 077 && mkdir ${dir}`), "Could not create the stdin directory");
      try {
        await client.writeFile(sandboxId, `${dir}/in`, stdin, signal);
        return await run(`{ rm -rf ${dir}; exec ${shellQuoteArgv(command)}; } < ${dir}/in`);
      } catch (error) {
        await removeQuietly(client, sandboxId, dir);
        throw error;
      }
    },
  };
}

async function expectSuccess(result: Promise<{ exitCode: number }>, failure: string): Promise<void> {
  const { exitCode } = await result;
  if (exitCode !== 0) throw new Error(`${failure} (exit ${exitCode}).`);
}

async function removeQuietly(client: CommandChannel, sandboxId: SandboxId, dir: string): Promise<void> {
  try {
    await client.run(sandboxId, {
      command: `rm -rf ${dir}`,
      timeoutSeconds: 10,
      signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
      onOutput: () => {},
    });
  } catch {
  }
}

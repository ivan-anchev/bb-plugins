// bb core's command channel into a boat sandbox. boat's commands API ignores `stdin` and keeps every
// command's text and output for 90 days (spike Q2), and core sends the enrollment secret on stdin, so
// stdin travels as a file in a private directory and never as command text.
import { randomUUID } from "node:crypto";
import type { MachineExecutor } from "@get-bb/plugin-sdk";
import type { BoatClient } from "./boat/client.ts";
import type { SandboxId } from "./boat/sandbox.ts";
import { shellQuoteArgv } from "./shell.ts";

/** boat refuses more; core's bootstrap asks for exactly this. */
const BOAT_MAX_TIMEOUT_SECONDS = 600;
/** For the cleanup after a failure, when the caller's signal may already be aborted. */
const CLEANUP_TIMEOUT_MS = 30_000;

type CommandChannel = Pick<BoatClient, "run" | "writeFile">;

export function boatExecutor(client: CommandChannel, sandboxId: SandboxId): MachineExecutor {
  return {
    async exec({ command, stdin, timeoutMs, signal, onOutput }) {
      const timeoutSeconds = Math.min(BOAT_MAX_TIMEOUT_SECONDS, Math.max(1, Math.ceil(timeoutMs / 1000)));
      const run = (text: string) => client.run(sandboxId, { command: text, timeoutSeconds, signal, onOutput });
      if (stdin === "") return run(`exec ${shellQuoteArgv(command)} </dev/null`);

      // /tmp is outside what boat snapshots, so a leftover never reaches a saved snapshot.
      const dir = `/tmp/bb-stdin.${randomUUID()}`;
      // A 0700 directory owned by `user`; mkdir fails if the path already exists.
      await expectSuccess(run(`umask 077 && mkdir ${dir}`), "Could not create the stdin directory");
      try {
        // The file lands 0644 (boat ignores the umask) but no other user can enter the directory.
        await client.writeFile(sandboxId, `${dir}/in`, stdin, signal);
        // The redirect opens the file before the block runs; the block deletes it, then execs core's argv on it.
        return await run(`{ rm -rf ${dir}; exec ${shellQuoteArgv(command)}; } < ${dir}/in`);
      } catch (error) {
        // Only on failure: on the normal path the command already deleted the directory.
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
    // The original failure is the one to report; /tmp does not outlive a cold resume.
  }
}

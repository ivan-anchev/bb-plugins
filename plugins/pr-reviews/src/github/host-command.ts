// Runs a host CLI (gh, git) and returns its stdout; a failure rejects with Node's ExecFileException.
import { experimental_execHostFile as execHostFile, experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import { z } from "zod";

// Keeps the command from ever waiting on a prompt or a pager, and keeps its messages in English
// so callers can classify stderr.
const QUIET_ENV = { GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1", LC_ALL: "C" };

/**
 * The command's environment: ours with QUIET_ENV on top. hostToolchain.environment builds the
 * child's env from its argument alone (adding only PATH and proxies), so without the spread gh
 * and git lose HOME and every config and credential variable, and gh asks for "gh auth login".
 */
export const hostCommandEnvironment = () => hostToolchain.environment({ ...process.env, ...QUIET_ENV });

// execHostFile resolves the command on the login-shell PATH, which a GUI-launched bb would
// otherwise lack.
export async function runHostCommand(command: "gh" | "git", args: string[]): Promise<string> {
  const { stdout } = await execHostFile(command, args, {
    encoding: "utf8",
    env: hostCommandEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
}

// Node's ExecFileException, parsed rather than cast. `code` is the exit code, or "ENOENT" when
// the command is not installed.
const failureSchema = z.object({ code: z.unknown(), stderr: z.string().default("") });

/** The exit code and stderr of a runHostCommand rejection. */
export const parseHostCommandFailure = (error: unknown) => failureSchema.parse(error);

export const firstLine = (text: string) => text.split("\n").find((line) => line.trim() !== "");

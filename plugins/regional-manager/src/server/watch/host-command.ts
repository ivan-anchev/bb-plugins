// Runs gh on the bb server's machine and returns its stdout; a failure rejects with Node's
// ExecFileException. Copied from pr-reviews (src/github/host-command.ts): a plugin installs
// standalone, so it can't import another's.
import { experimental_execHostFile as execHostFile, experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import { z } from "zod";

// Keeps gh from ever waiting on a prompt or a pager, and keeps its messages in English so the
// watch can classify stderr.
const QUIET_ENV = { GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", NO_COLOR: "1", LC_ALL: "C" };

/**
 * gh's environment: ours with QUIET_ENV on top. hostToolchain.environment builds the child's env
 * from its argument alone (adding only PATH and proxies), so without the spread gh loses HOME and
 * every config and credential variable, and asks for "gh auth login".
 */
const hostCommandEnvironment = () => hostToolchain.environment({ ...process.env, ...QUIET_ENV });

// execHostFile resolves gh on the login-shell PATH, which a GUI-launched bb would otherwise lack.
export async function runGh(args: string[]): Promise<string> {
  const { stdout } = await execHostFile("gh", args, {
    encoding: "utf8",
    env: hostCommandEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
}

// Node's ExecFileException, parsed rather than cast. `code` is the exit code, or a spawn error:
// "ENOENT" when gh is not installed. `killed`: the timeout stopped it.
const failureSchema = z.object({ code: z.unknown(), stdout: z.string().default(""), stderr: z.string().default(""), killed: z.boolean().default(false) });
export type HostCommandFailure = z.infer<typeof failureSchema>;

/** The exit code, output and timeout flag of a runGh rejection. */
export const parseHostCommandFailure = (error: unknown): HostCommandFailure => failureSchema.parse(error);

export const firstLine = (text: string) => text.split("\n").find((line) => line.trim() !== "");

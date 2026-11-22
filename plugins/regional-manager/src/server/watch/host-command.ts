import { experimental_execHostFile as execHostFile, experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import { z } from "zod";

const QUIET_ENV = { GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", NO_COLOR: "1", LC_ALL: "C" };

const hostCommandEnvironment = () => hostToolchain.environment({ ...process.env, ...QUIET_ENV });

export async function runGh(args: string[]): Promise<string> {
  const { stdout } = await execHostFile("gh", args, {
    encoding: "utf8",
    env: hostCommandEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
}

const failureSchema = z.object({ code: z.unknown(), stdout: z.string().default(""), stderr: z.string().default(""), killed: z.boolean().default(false) });
export type HostCommandFailure = z.infer<typeof failureSchema>;

/** The exit code, output and timeout flag of a runGh rejection. */
export const parseHostCommandFailure = (error: unknown): HostCommandFailure => failureSchema.parse(error);

export const firstLine = (text: string) => text.split("\n").find((line) => line.trim() !== "");

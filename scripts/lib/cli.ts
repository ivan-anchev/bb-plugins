// Small process helpers shared by the scripts' entry points.
import { execFileSync } from "node:child_process";
import { ROOT } from "./repo.ts";

/** Print every problem and exit non-zero. */
export function fail(problems: string[]): never {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}

/** Exit non-zero when there are problems; returns normally when there are none. */
export function exitWithProblems(problems: string[]): void {
  if (problems.length > 0) fail(problems);
}

/** Run a command (from the repository root by default) and return its trimmed stdout. */
export function run(command: string, args: string[], cwd: string = ROOT): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

/** The plugin id a script takes as its only positional argument. */
export function requirePluginIdArgument(usage: string): string {
  const id = process.argv[2];
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) fail([`usage: ${usage}  (id: lowercase letters, digits, -)`]);
  return id;
}

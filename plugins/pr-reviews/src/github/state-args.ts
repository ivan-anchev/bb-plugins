// The `gh pr` command that makes each state change. Pure.
import type { StateChange } from "../contract.ts";
import type { Repo } from "./repo.ts";

const SUBCOMMANDS = {
  ready: ["ready"],
  draft: ["ready", "--undo"],
  close: ["close"],
  reopen: ["reopen"],
} as const satisfies Record<StateChange, readonly string[]>;

// why the number and -R: without them gh acts on the current directory's branch, and the server
// runs gh in no checkout.
export function stateChangeArgs(repo: Repo, number: number, change: StateChange): string[] {
  const [subcommand, ...flags] = SUBCOMMANDS[change];
  return ["pr", subcommand, String(number), ...flags, "-R", repo];
}

import type { MergeMethod, StateChange } from "../contract.ts";
import type { Repo } from "./repo.ts";

const SUBCOMMANDS = {
  ready: ["ready"],
  draft: ["ready", "--undo"],
  close: ["close"],
  reopen: ["reopen"],
} as const satisfies Record<StateChange, readonly string[]>;

const MERGE_FLAGS = { merge: "--merge", squash: "--squash", rebase: "--rebase" } as const satisfies Record<MergeMethod, string>;

export function stateChangeArgs(repo: Repo, number: number, change: StateChange): string[] {
  const [subcommand, ...flags] = SUBCOMMANDS[change];
  return ["pr", subcommand, String(number), ...flags, "-R", repo];
}

export function mergeArgs(repo: Repo, number: number, method: MergeMethod, headSha: string): string[] {
  return ["pr", "merge", String(number), MERGE_FLAGS[method], "--match-head-commit", headSha, "-R", repo];
}

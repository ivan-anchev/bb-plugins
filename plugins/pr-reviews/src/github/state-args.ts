// The `gh pr` command that makes each state change, and the one that merges. Pure.
import type { MergeMethod, StateChange } from "../contract.ts";
import type { Repo } from "./repo.ts";

const SUBCOMMANDS = {
  ready: ["ready"],
  draft: ["ready", "--undo"],
  close: ["close"],
  reopen: ["reopen"],
} as const satisfies Record<StateChange, readonly string[]>;

const MERGE_FLAGS = { merge: "--merge", squash: "--squash", rebase: "--rebase" } as const satisfies Record<MergeMethod, string>;

// why the number and -R: without them gh acts on the current directory's branch, and the server
// runs gh in no checkout.
export function stateChangeArgs(repo: Repo, number: number, change: StateChange): string[] {
  const [subcommand, ...flags] = SUBCOMMANDS[change];
  return ["pr", subcommand, String(number), ...flags, "-R", repo];
}

// why --match-head-commit: GitHub then refuses a merge once a push has moved the head past the one
// the reader saw.
export function mergeArgs(repo: Repo, number: number, method: MergeMethod, headSha: string): string[] {
  return ["pr", "merge", String(number), MERGE_FLAGS[method], "--match-head-commit", headSha, "-R", repo];
}

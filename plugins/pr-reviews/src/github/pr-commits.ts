// Makes a PR's head and base commits local to the project's repository before a review thread
// starts, because the review thread's sandbox cannot reach GitHub. Each commit lands in a
// plugin-owned ref, so git keeps it, and the review worktree (made from the same repository)
// can check it out.
import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import { firstLine, parseHostCommandFailure, runHostCommand } from "./host-command.ts";

/** The two commits a PR's diff is taken between. */
export type PrCommits = { headSha: string; baseSha: string };

// Fetched by sha, not by branch, so the refs hold exactly the commits the pinned diff was read
// at: a push after the snapshot cannot move them. GitHub serves any commit reachable from the
// repo's refs, a fork's PR head included (through refs/pull/<n>/head).
export async function fetchPrCommits(checkoutPath: string, number: number, { headSha, baseSha }: PrCommits): Promise<void> {
  const refspecs = [`+${headSha}:refs/pr-reviews/${number}/head`, `+${baseSha}:refs/pr-reviews/${number}/base`];
  try {
    await runHostCommand("git", ["-C", checkoutPath, "fetch", "--no-tags", "--quiet", "origin", ...refspecs]);
  } catch (error) {
    const { stderr } = parseHostCommandFailure(error);
    throw new Refusal({ code: "invalid", message: `Could not fetch PR #${number}'s commits: ${firstLine(stderr) ?? "git fetch failed."}` });
  }
}

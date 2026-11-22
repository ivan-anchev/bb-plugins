import { experimental_PluginRpcRefusal as Refusal } from "@get-bb/plugin-sdk";
import { firstLine, parseHostCommandFailure, runHostCommand } from "./host-command.ts";

/** The two commits a PR's diff is taken between. */
export type PrCommits = { headSha: string; baseSha: string };

export async function fetchPrCommits(checkoutPath: string, number: number, { headSha, baseSha }: PrCommits): Promise<void> {
  const refspecs = [`+${headSha}:refs/pr-reviews/${number}/head`, `+${baseSha}:refs/pr-reviews/${number}/base`];
  try {
    await runHostCommand("git", ["-C", checkoutPath, "fetch", "--no-tags", "--quiet", "origin", ...refspecs]);
  } catch (error) {
    const { stderr } = parseHostCommandFailure(error);
    throw new Refusal({ code: "invalid", message: `Could not fetch PR #${number}'s commits: ${firstLine(stderr) ?? "git fetch failed."}` });
  }
}

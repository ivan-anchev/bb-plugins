// bb's GitHub PR Status plugin (`bb--github-pr-status`) as this list reads it, and what a row shows of it.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The part of `bb--github-pr-status`'s `pullRequests` this list reads (`bb plugin rpc inspect
 * bb--github-pr-status pullRequests` prints the whole). Keyed by environment id; each row is the
 * current branch's pull request, none, or unavailable (machine offline, `gh` failed).
 */
export const githubPrStatus = defineRpcContract({
  pullRequests: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.discriminatedUnion("outcome", [
        z.object({
          outcome: z.literal("available"),
          pullRequest: z.object({
            number: z.number(),
            title: z.string(),
            url: z.string(),
            state: z.enum(["draft", "open", "merged", "closed"]),
          }),
        }),
        z.object({ outcome: z.literal("absent") }),
        z.object({ outcome: z.literal("unavailable"), message: z.string() }),
      ]),
    ),
  },
});

type PullRequestRow = z.infer<(typeof githubPrStatus)["pullRequests"]["output"]>[string];
export type PullRequest = Extract<PullRequestRow, { outcome: "available" }>["pullRequest"];

/** What a row shows of its pull request row: the pull request when available; absent, unavailable or unread show nothing. */
export function shownPullRequest(row: PullRequestRow | undefined): PullRequest | null {
  return row?.outcome === "available" ? row.pullRequest : null;
}

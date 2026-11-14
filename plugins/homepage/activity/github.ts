// Reads the signed-in gh user's merged PRs through GitHub search, 100 per page,
// and words a failure as the line the card shows instead.
import { experimental_execHostFile as execHostFile, experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import { z } from "zod";
import type { MergedPr } from "../contract.ts";

const QUERY = `query($q: String!, $endCursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { mergedAt additions deletions } }
  }
}`;

const pagesSchema = z.array(
  z.object({
    data: z.object({
      search: z.object({
        nodes: z.array(z.object({ mergedAt: z.string(), additions: z.number(), deletions: z.number() })),
      }),
    }),
  }),
);

/** Merged PRs authored by the gh user on or after `since` (YYYY-MM-DD). */
export async function readMergedPrs(since: string): Promise<MergedPr[]> {
  const { stdout } = await execHostFile("gh", searchArgs(since), {
    encoding: "utf8",
    // why: hostToolchain.environment builds the env from its argument alone, so without the
    // spread gh loses HOME and its credentials.
    env: hostToolchain.environment({ ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", NO_COLOR: "1" }),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  return parseMergedPrs(stdout);
}

export const searchArgs = (since: string) => [
  "api", "graphql", "--paginate", "--slurp",
  "-f", `q=is:pr is:merged author:@me merged:>=${since}`,
  "-f", `query=${QUERY}`,
];

export function parseMergedPrs(stdout: string): MergedPr[] {
  return pagesSchema
    .parse(JSON.parse(stdout))
    .flatMap((page) => page.data.search.nodes)
    .map((pr) => ({ mergedAt: Date.parse(pr.mergedAt), lines: pr.additions + pr.deletions }));
}

/** The card's caption when the read failed: ENOENT means gh is not installed. */
export function describeFailure(error: unknown): string {
  const code = z.object({ code: z.unknown() }).safeParse(error);
  return code.success && code.data.code === "ENOENT"
    ? "Install the GitHub CLI (gh) to see your merged PRs."
    : "Couldn’t read GitHub. Check that gh is signed in.";
}

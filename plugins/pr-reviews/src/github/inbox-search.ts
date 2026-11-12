// The sidebar's PRs as GitHub's GraphQL API serves them: one search per section, restricted to the
// bb projects' repos, and the open and recently merged PRs of the repos those found, which hold
// the found PRs' stack-mates. gh.ts runs the queries. Pure.
import { z } from "zod";
import type { InboxPr, SectionKey } from "../contract.ts";
import { repoSchema, type Repo } from "./repo.ts";

/** A PR as GitHub reports it, before the sidebar gives it a project and a section. */
export type GitHubPr = Omit<InboxPr, "projectId" | "section">;

/** A PR one of the section searches found, and the section that search fills. */
export type FoundPr = { section: SectionKey; pr: GitHubPr };

// GitHub's largest page. A section past it lists its most recently updated 100.
const FIRST = 100;
// Closed and merged PRs stay listed this long. Search dates are whole days.
const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
// How many of a repo's merged PRs to read for stack-mates: a stack's merged bottom merged recently.
const RECENTLY_MERGED = 20;

const PR_FIELDS = `fragment InboxPr on PullRequest {
  number title isDraft state updatedAt mergedAt baseRefName headRefName reviewDecision
  repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`;

const searchNameSchema = z.enum(["authoredOpen", "authoredClosed", "review", "mergedAuthored", "mergedReviewed"]);
type SearchName = z.infer<typeof searchNameSchema>;
const SEARCH_NAMES = searchNameSchema.options;

/** Each search, the section it fills and its qualifiers. Definitions: decisions.md #4–#6. */
const SEARCHES: Record<SearchName, { section: SectionKey; qualifiers(since: string): string }> = {
  authoredOpen: { section: "authored", qualifiers: () => "is:open author:@me" },
  authoredClosed: { section: "authored", qualifiers: (since) => `is:closed is:unmerged author:@me closed:>=${since}` },
  review: { section: "review", qualifiers: () => "is:open draft:false review-requested:@me -author:@me" },
  mergedAuthored: { section: "merged", qualifiers: (since) => `is:merged author:@me merged:>=${since}` },
  mergedReviewed: { section: "merged", qualifiers: (since) => `is:merged reviewed-by:@me merged:>=${since}` },
};

/** Every section search in one query, each search string a variable named after it. */
export const INBOX_QUERY = `${PR_FIELDS}
query(${SEARCH_NAMES.map((name) => `$${name}: String!`).join(", ")}) {
  ${SEARCH_NAMES.map((name) => `${name}: search(query: $${name}, type: ISSUE, first: ${FIRST}) { nodes { ...InboxPr } }`).join("\n  ")}
}`;

/** INBOX_QUERY's variables at `now` (epoch ms): each search over `repos`, closed or merged in the last RECENT_DAYS where it asks. */
export function inboxVariables(repos: Repo[], now: number): Record<string, string> {
  const since = new Date(now - RECENT_DAYS * DAY_MS).toISOString().slice(0, 10);
  const scope = repos.map((repo) => `repo:${repo}`).join(" ");
  return Object.fromEntries(SEARCH_NAMES.map((name) => [name, `is:pr ${SEARCHES[name].qualifiers(since)} sort:updated-desc ${scope}`]));
}

/** One query for the open and recently merged PRs of each repo. A Repo is `owner/name` of word characters, dots and dashes, so it is safe to inline. */
export function stackContextQuery(repos: Repo[]): string {
  const prs = (states: string, first: number) =>
    `pullRequests(states: ${states}, first: ${first}, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...InboxPr } }`;
  const reads = repos.map((repo, index) => {
    const [owner, name] = repo.split("/");
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { open: ${prs("OPEN", FIRST)} merged: ${prs("MERGED", RECENTLY_MERGED)} }`;
  });
  return `${PR_FIELDS}\nquery {\n  ${reads.join("\n  ")}\n}`;
}

// GitHub adds review decisions and rollup states over time, so both stay strings; only the ones
// the sidebar flags are compared against.
const ghPrSchema = z.object({
  number: z.number(),
  title: z.string(),
  isDraft: z.boolean(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
  baseRefName: z.string(),
  headRefName: z.string(),
  reviewDecision: z.string().nullable(),
  repository: z.object({ nameWithOwner: repoSchema }),
  // A deleted account's PR has no author.
  author: z.object({ login: z.string() }).nullable(),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).nullable() }) })) }),
});

const FAILING_ROLLUP = new Set(["FAILURE", "ERROR"]);

const toGitHubPr = (pr: z.infer<typeof ghPrSchema>): GitHubPr => ({
  repo: pr.repository.nameWithOwner,
  number: pr.number,
  title: pr.title,
  // GitHub shows a deleted account as "ghost".
  author: pr.author?.login ?? "ghost",
  // A closed PR can still be marked draft; it reads as closed, as on GitHub.
  state: pr.state === "OPEN" && pr.isDraft ? "DRAFT" : pr.state,
  updatedAt: pr.updatedAt,
  mergedAt: pr.mergedAt,
  baseRefName: pr.baseRefName,
  headRefName: pr.headRefName,
  ciFailing: FAILING_ROLLUP.has(pr.commits.nodes.at(0)?.commit.statusCheckRollup?.state ?? ""),
  changesRequested: pr.reviewDecision === "CHANGES_REQUESTED",
});

const nodesSchema = z.object({ nodes: z.array(ghPrSchema) });

/** INBOX_QUERY's response: every PR found, with the section of the search that found it. */
export function parseInboxSearch(json: unknown): FoundPr[] {
  const data = z.object({ data: z.record(searchNameSchema, nodesSchema) }).parse(json).data;
  return SEARCH_NAMES.flatMap((name) => data[name].nodes.map((pr) => ({ section: SEARCHES[name].section, pr: toGitHubPr(pr) })));
}

/** stackContextQuery's response: every repo's open and recently merged PRs. */
export function parseStackContext(json: unknown): GitHubPr[] {
  const repos = z.object({ data: z.record(z.string(), z.object({ open: nodesSchema, merged: nodesSchema })) }).parse(json).data;
  return Object.values(repos).flatMap((repo) => [...repo.open.nodes, ...repo.merged.nodes].map(toGitHubPr));
}

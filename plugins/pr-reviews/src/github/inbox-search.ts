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

// GitHub's largest page. A search past it reads its most recently updated 100.
const FIRST = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
// Closed and merged PRs stay listed this long after they close or merge.
const RECENT_MS = 7 * DAY_MS;
// How many of a repo's merged PRs to read for stack-mates: a stack's merged bottom merged recently.
const RECENTLY_MERGED = 20;

const PR_FIELDS = `fragment InboxPr on PullRequest {
  number title isDraft state updatedAt mergedAt baseRefName headRefName reviewDecision
  repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`;

const searchNameSchema = z.enum(["authoredOpen", "authoredClosed", "review", "mergedAuthored", "mergedReviewed"]);
type SearchName = z.infer<typeof searchNameSchema>;
const SEARCH_NAMES = searchNameSchema.options;

/**
 * Each search, the section it fills, its qualifiers, and for a closed or merged one the time it
 * ended at, which must be in the last RECENT_MS. Definitions: decisions.md #4–#6.
 */
const SEARCHES: Record<SearchName, { section: SectionKey; qualifiers: string; endedAt?: "closedAt" | "mergedAt" }> = {
  authoredOpen: { section: "authored", qualifiers: "is:open author:@me" },
  authoredClosed: { section: "authored", qualifiers: "is:closed is:unmerged author:@me", endedAt: "closedAt" },
  review: { section: "review", qualifiers: "is:open draft:false review-requested:@me -author:@me" },
  mergedAuthored: { section: "merged", qualifiers: "is:merged author:@me", endedAt: "mergedAt" },
  mergedReviewed: { section: "merged", qualifiers: "is:merged reviewed-by:@me", endedAt: "mergedAt" },
};

/** Every section search in one query, each search string a variable named after it. */
export const INBOX_QUERY = `${PR_FIELDS}
fragment FoundPr on PullRequest { ...InboxPr closedAt }
query(${SEARCH_NAMES.map((name) => `$${name}: String!`).join(", ")}) {
  ${SEARCH_NAMES.map((name) => `${name}: search(query: $${name}, type: ISSUE, first: ${FIRST}) { nodes { ...FoundPr } }`).join("\n  ")}
}`;

/**
 * INBOX_QUERY's variables at `now` (epoch ms): each search over `repos`. GitHub's `closed:` misses
 * some closed PRs, so a closed or merged search asks instead for PRs updated since the day before
 * the window opens: closing or merging updates a PR, and the spare day covers whatever time zone
 * GitHub reads the date in. parseInboxSearch cuts the result to the window.
 */
export function inboxVariables(repos: Repo[], now: number): Record<string, string> {
  const updatedSince = `updated:>=${new Date(now - RECENT_MS - DAY_MS).toISOString().slice(0, 10)}`;
  const scope = repos.map((repo) => `repo:${repo}`).join(" ");
  return Object.fromEntries(
    SEARCH_NAMES.map((name) => {
      const { qualifiers, endedAt } = SEARCHES[name];
      return [name, `is:pr ${qualifiers}${endedAt === undefined ? "" : ` ${updatedSince}`} sort:updated-desc ${scope}`];
    }),
  );
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
const foundNodesSchema = z.object({ nodes: z.array(ghPrSchema.extend({ closedAt: z.string().nullable() })) });

/**
 * INBOX_QUERY's response at `now` (epoch ms): every PR found, with the section of the search that
 * found it; a closed or merged one only if it closed or merged in the last RECENT_MS.
 */
export function parseInboxSearch(json: unknown, now: number): FoundPr[] {
  const data = z.object({ data: z.record(searchNameSchema, foundNodesSchema) }).parse(json).data;
  const inWindow = (time: string | null) => time !== null && Date.parse(time) >= now - RECENT_MS;
  return SEARCH_NAMES.flatMap((name) => {
    const { section, endedAt } = SEARCHES[name];
    const kept = data[name].nodes.filter((pr) => endedAt === undefined || inWindow(pr[endedAt]));
    return kept.map((pr) => ({ section, pr: toGitHubPr(pr) }));
  });
}

/** stackContextQuery's response: every repo's open and recently merged PRs. */
export function parseStackContext(json: unknown): GitHubPr[] {
  const repos = z.object({ data: z.record(z.string(), z.object({ open: nodesSchema, merged: nodesSchema })) }).parse(json).data;
  return Object.values(repos).flatMap((repo) => [...repo.open.nodes, ...repo.merged.nodes].map(toGitHubPr));
}

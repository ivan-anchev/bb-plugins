import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { INBOX_QUERY, inboxVariables, parseInboxSearch, parseStackContext, stackContextQuery } from "./inbox-search.ts";
import { repoSchema } from "./repo.ts";

// Real responses, recorded with `gh api graphql` for INBOX_QUERY over this repo, ngx-zero and two
// private repos, and for stackContextQuery over the private two; trimmed to a few PRs per search.
// The private repos' rows are stand-ins (octo-org/atlas, Octo-Labs/beacon): their titles and
// branch names are synthetic, and which branch builds on which, numbers, states and times are as recorded.
// The search response's closedAt times were added later from `gh pr view --json closedAt`.
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/inbox/${name}.json`, import.meta.url), "utf8"));

const ATLAS = repoSchema.parse("octo-org/atlas");
const BEACON = repoSchema.parse("Octo-Labs/beacon");
const NOV_12 = Date.parse("2026-11-12T10:00:00Z");

test("each search is scoped to the projects' repos, and closed or merged ones to PRs updated in the last 8 days", () => {
  const variables = inboxVariables([ATLAS, BEACON], NOV_12);
  assert.deepEqual(variables, {
    authoredOpen: "is:pr is:open author:@me sort:updated-desc repo:octo-org/atlas repo:Octo-Labs/beacon",
    authoredClosed: "is:pr is:closed is:unmerged author:@me updated:>=2026-11-04 sort:updated-desc repo:octo-org/atlas repo:Octo-Labs/beacon",
    review: "is:pr is:open draft:false review-requested:@me -author:@me sort:updated-desc repo:octo-org/atlas repo:Octo-Labs/beacon",
    mergedAuthored: "is:pr is:merged author:@me updated:>=2026-11-04 sort:updated-desc repo:octo-org/atlas repo:Octo-Labs/beacon",
    mergedReviewed: "is:pr is:merged reviewed-by:@me updated:>=2026-11-04 sort:updated-desc repo:octo-org/atlas repo:Octo-Labs/beacon",
  });
  // The query declares exactly the variables it is given.
  for (const name of Object.keys(variables)) assert.match(INBOX_QUERY, new RegExp(`\\$${name}: String!`));
  // GitHub refuses a query that defines a fragment it doesn't use.
  assert.doesNotMatch(stackContextQuery([ATLAS]), /FoundPr/);
});

test("the stack-mate query reads each repo's open and recently merged PRs under its own alias", () => {
  const query = stackContextQuery([ATLAS, BEACON]);
  assert.match(query, /r0: repository\(owner: "octo-org", name: "atlas"\) \{ open: pullRequests\(states: OPEN, first: 100,/);
  assert.match(query, /r1: repository\(owner: "Octo-Labs", name: "beacon"\) \{ open: .* merged: pullRequests\(states: MERGED, first: 20,/);
});

test("every PR found is in its search's section, both authored searches in Authored by me", () => {
  const found = parseInboxSearch(fixture("search"), NOV_12);
  assert.deepEqual(
    found.map(({ section, pr }) => `${section} ${pr.repo}#${pr.number}`),
    [
      ...[67, 65, 66, 64, 63].map((number) => `authored octo-org/atlas#${number}`),
      "authored ivan-anchev/bb-plugins#83",
      "authored Octo-Labs/beacon#42",
      "authored ivan-anchev/bb-plugins#81",
      "authored ivan-anchev/bb-plugins#79",
      "review ivan-anchev/ngx-zero#51",
      "review ivan-anchev/ngx-zero#50",
      "review ivan-anchev/ngx-zero#49",
      "merged ivan-anchev/bb-plugins#82",
      "merged ivan-anchev/bb-plugins#80",
      "merged ivan-anchev/bb-plugins#78",
    ],
  );
});

test("a found PR reads as the sidebar needs it: draft as a state, failing CI and its branches", () => {
  const found = parseInboxSearch(fixture("search"), NOV_12);
  const pr = (number: number) => found.find((entry) => entry.pr.number === number)?.pr;

  assert.deepEqual(pr(51), {
    repo: "ivan-anchev/ngx-zero",
    number: 51,
    title: "chore(deps): bump zod from 4.4.3 to 4.6.6",
    author: "dependabot",
    state: "OPEN",
    updatedAt: "2026-11-03T19:07:33Z",
    mergedAt: null,
    baseRefName: "main",
    headRefName: "dependabot/npm_and_yarn/zod-4.6.6",
    ciFailing: true,
    changesRequested: false,
  });
  assert.equal(pr(83)?.state, "DRAFT");
  assert.equal(pr(81)?.state, "CLOSED");
  assert.deepEqual([pr(82)?.state, pr(82)?.mergedAt], ["MERGED", "2026-11-11T15:05:22Z"]);
  // #50 has no failing check, and a PR with no checks at all has a null rollup.
  assert.equal(pr(50)?.ciFailing, false);
  assert.deepEqual([pr(63)?.baseRefName, pr(64)?.baseRefName], ["main", "topic-5"]);
});

// A search response holding `nodes` under each search name given, and none under the rest.
const searchOf = (nodes: Partial<Record<"authoredOpen" | "authoredClosed" | "mergedAuthored", object[]>>) => ({
  data: { authoredOpen: { nodes: [] }, authoredClosed: { nodes: [] }, review: { nodes: [] }, mergedAuthored: { nodes: [] }, mergedReviewed: { nodes: [] }, ...Object.fromEntries(Object.entries(nodes).map(([name, list]) => [name, { nodes: list }])) },
});
const node = (fields: object) => ({
  number: 7, title: "Fixture", isDraft: false, state: "OPEN", updatedAt: "2026-11-12T00:00:00Z", mergedAt: null, closedAt: null,
  baseRefName: "main", headRefName: "topic", reviewDecision: null, repository: { nameWithOwner: "octo-org/atlas" },
  author: { login: "ivan-anchev" }, commits: { nodes: [] }, ...fields,
});

test("changes requested, an erroring rollup and a deleted author", () => {
  const erroring = node({ reviewDecision: "CHANGES_REQUESTED", author: null, commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR" } } }] } });
  const [{ pr }] = parseInboxSearch(searchOf({ authoredOpen: [erroring] }), NOV_12);
  assert.deepEqual([pr.changesRequested, pr.ciFailing, pr.author], [true, true, "ghost"]);
});

test("closed and merged PRs are kept exactly while they closed or merged in the last 7×24 hours, drafts included", () => {
  // NOV_12 is 10:00 UTC, so the window opens at 2026-11-05T10:00:00Z.
  const closed = (number: number, closedAt: string, isDraft = false) => node({ number, state: "CLOSED", isDraft, closedAt, updatedAt: closedAt });
  const merged = (number: number, mergedAt: string) => node({ number, state: "MERGED", mergedAt, closedAt: mergedAt, updatedAt: mergedAt });
  const found = parseInboxSearch(
    searchOf({
      // An open PR stays however old its last update.
      authoredOpen: [node({ number: 1, updatedAt: "2026-06-01T00:00:00Z" })],
      authoredClosed: [closed(2, "2026-11-05T10:00:00Z"), closed(3, "2026-11-05T09:59:59Z"), closed(57, "2026-11-09T15:35:01Z", true)],
      mergedAuthored: [merged(4, "2026-11-05T10:00:01Z"), merged(5, "2026-11-05T09:59:59Z"), merged(6, "2026-11-05T10:26:47Z")],
    }),
    NOV_12,
  );
  assert.deepEqual(
    found.map(({ section, pr }) => `${section} #${pr.number}`),
    ["authored #1", "authored #2", "authored #57", "merged #4", "merged #6"],
  );
  // The same merge a day later is over 7×24 hours old.
  assert.deepEqual(parseInboxSearch(searchOf({ mergedAuthored: [merged(6, "2026-11-05T10:26:47Z")] }), NOV_12 + 24 * 60 * 60 * 1000), []);
});

test("stack-mates are every repo's open PRs, then its recently merged ones", () => {
  const prs = parseStackContext(fixture("context"));
  const of = (repo: string) => prs.filter((pr) => pr.repo === repo).map((pr) => `${pr.number} ${pr.state}`);
  assert.deepEqual(of("octo-org/atlas"), ["67 OPEN", "65 OPEN", "66 OPEN", "64 OPEN", "63 OPEN", "59 MERGED", "62 MERGED", "61 MERGED"]);
  assert.equal(of("Octo-Labs/beacon").length, 17);
  assert.equal(prs.find((pr) => pr.number === 43 && pr.repo === BEACON)?.state, "DRAFT");
});

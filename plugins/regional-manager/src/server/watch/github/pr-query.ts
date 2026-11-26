// The GitHub reads the PR watch makes: every watched branch of one repository in one
// `gh api graphql` call, each as an aliased pullRequests(headRefName:) field, and its answer parsed
// at this boundary into snapshots; and the branch a pull request named by its URL is from. A
// repository is `owner/name`, as locate.ts reads it from a github.com remote.
import { z } from "zod";
import { commitSchema } from "../../../model/agent/handoff.ts";
import type { BranchesRead, PrSnapshot } from "../../../model/verdict/pr.ts";
import { jsonOrNull, parseHostCommandFailure, type RunCli } from "../host-command.ts";
import { ghFailure, UNREADABLE_ANSWER } from "./gh-failure.ts";

/** Every branch's newest pull request in the repository (null: none), in one gh call with no --hostname, so on github.com; or why it couldn't be read. */
export async function readGitHub(run: RunCli, repo: string, branches: readonly string[]): Promise<BranchesRead> {
  let stdout: string;
  try {
    stdout = await run("gh", prQueryArgs(repo, branches));
  } catch (error) {
    return { kind: "unavailable", unavailable: ghFailure(parseHostCommandFailure(error)) };
  }
  const prs = parsePrs(stdout, branches);
  return prs === null ? { kind: "unavailable", unavailable: UNREADABLE_ANSWER } : { kind: "read", prs };
}

/**
 * GitHub's newest pull request from each branch, its head commit and that commit's CI rolled up.
 * why `first: 100` contexts: the rollup's state is GitHub's verdict on all of them; the names only
 * say which failed, and 100 is the most one page holds.
 */
const PR_FIELDS = `number url state isDraft reviewDecision
  commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) { nodes {
    __typename ... on CheckRun { name conclusion } ... on StatusContext { context state } } } } } } }`;

/** The `gh api graphql` arguments that read each branch's newest pull request. Every value goes as a variable, never into the query's text. */
function prQueryArgs(repo: string, branches: readonly string[]): string[] {
  const [owner, name] = repo.split("/");
  const variables = branches.map((_, i) => `$b${i}: String!`).join(", ");
  const fields = branches.map((_, i) => `b${i}: pullRequests(headRefName: $b${i}, first: 1, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PR_FIELDS} } }`).join("\n");
  const query = `query($owner: String!, $name: String!, ${variables}) { repository(owner: $owner, name: $name) {\n${fields}\n} }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, ...branches.flatMap((branch, i) => ["-f", `b${i}=${branch}`])];
}

// A pull request's page on github.com: https://github.com/owner/name/pull/41, with any path, query or fragment after it.
const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

/** The repository, `owner/name`, and number of a github.com pull request's URL, or null for any other URL. */
export function parsePrUrl(url: string): { repo: string; number: number } | null {
  const match = PR_URL.exec(url.trim());
  return match === null ? null : { repo: `${match[1]}/${match[2]}`, number: Number(match[3]) };
}

/** The `gh api graphql` arguments that read the branch a pull request is from. Every value goes as a variable, never into the query's text. */
export function prHeadQueryArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/");
  const query = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefName } } }";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

const headResponseSchema = z.object({ data: z.object({ repository: z.object({ pullRequest: z.object({ headRefName: z.string().min(1) }).nullable() }) }) });

/** The branch a pull request is from, from gh's answer to prHeadQueryArgs; null when it names none or isn't an answer. */
export function parsePrHead(stdout: string): string | null {
  const parsed = headResponseSchema.safeParse(jsonOrNull(stdout));
  return parsed.success ? (parsed.data.data.repository.pullRequest?.headRefName ?? null) : null;
}

// why `catch` on each state: GitHub can add a value later, and one this plugin doesn't know is not
// a pass. A rollup GitHub hasn't settled is pending; a check it hasn't concluded hasn't failed.
const rollupStateSchema = z.enum(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]).catch("PENDING");
const FAILED_CONCLUSIONS = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);

const contextSchema = z.union([
  z.object({ __typename: z.literal("CheckRun"), name: z.string(), conclusion: z.string().nullable() }).transform(({ name, conclusion }) => ({ name, failed: conclusion !== null && FAILED_CONCLUSIONS.has(conclusion) })),
  z.object({ __typename: z.literal("StatusContext"), context: z.string(), state: z.string() }).transform(({ context, state }) => ({ name: context, failed: FAILED_STATES.has(state) })),
  // A kind GitHub adds later says nothing the rollup's state doesn't.
  z.object({ __typename: z.string() }).transform(() => null),
]);

const CI: Record<z.infer<typeof rollupStateSchema>, PrSnapshot["ci"]> = { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "pending", EXPECTED: "pending" };
const STATE = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const;
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes-requested" } as const;

const prNodeSchema = z
  .object({
    number: z.number().int().positive(),
    url: z.url(),
    state: z.enum(["OPEN", "MERGED", "CLOSED"]),
    isDraft: z.boolean(),
    // why `catch`: REVIEW_REQUIRED, null and any value GitHub adds later are neither an approval nor a change request.
    reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED"]).nullable().catch(null),
    // why one: `commits(last: 1)` reads the head commit alone.
    commits: z.object({
      nodes: z.tuple([z.object({ commit: z.object({ oid: commitSchema, statusCheckRollup: z.object({ state: rollupStateSchema, contexts: z.object({ nodes: z.array(contextSchema) }) }).nullable() }) })]),
    }),
  })
  .transform((pr): PrSnapshot => {
    const [{ commit }] = pr.commits.nodes;
    const rollup = commit.statusCheckRollup;
    const ci = rollup === null ? "none" : CI[rollup.state];
    return {
      forge: "github",
      number: pr.number,
      url: pr.url,
      state: STATE[pr.state],
      draft: pr.isDraft,
      review: pr.reviewDecision === null ? "none" : REVIEW[pr.reviewDecision],
      ci,
      headSha: commit.oid,
      failedChecks: ci === "fail" && rollup !== null ? rollup.contexts.nodes.flatMap((check) => (check?.failed ? [check.name] : [])) : [],
    };
  });

const responseSchema = z.object({ data: z.object({ repository: z.record(z.string(), z.object({ nodes: z.array(prNodeSchema).max(1) })) }) });

/** Each branch's newest pull request (null: it has none) from gh's answer to prQueryArgs, or null when the answer isn't one. */
function parsePrs(stdout: string, branches: readonly string[]): Map<string, PrSnapshot | null> | null {
  const parsed = responseSchema.safeParse(jsonOrNull(stdout));
  if (!parsed.success) return null;
  const { repository } = parsed.data.data;
  const prs = new Map<string, PrSnapshot | null>();
  for (const [i, branch] of branches.entries()) {
    const field = repository[`b${i}`];
    if (field === undefined) return null;
    prs.set(branch, field.nodes[0] ?? null);
  }
  return prs;
}

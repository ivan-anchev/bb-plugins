// The GitLab read the PR watch makes: each watched branch's newest merge request and its head
// pipeline, in one `glab api graphql --hostname H` call per five branches, its answer parsed at
// this boundary into snapshots. Every value goes as a `-f` variable, never into the query's text.
import { z } from "zod";
import { commitSchema } from "../../../model/agent/handoff.ts";
import type { BranchesRead, PrSnapshot, PrUnavailable } from "../../../model/verdict/pr.ts";
import { jsonOrNull, parseHostCommandFailure, type RunCli } from "../host-command.ts";
import type { ForgeRepo } from "../locate.ts";
import { glabFailure } from "./glab-failure.ts";

type GitLabRepo = Extract<ForgeRepo, { forge: "gitlab" }>;

// why five: five aliases with this selection scored 104 of GitLab's 250 complexity limit on station-ws (review.md).
const BRANCHES_PER_CALL = 5;

/**
 * The fields each alias selects. why no pipeline sha: GitLab's headPipeline is already the head's,
 * its own sha or a merged-results pipeline's on another (38 of 40 station-ws merge requests had
 * one), so comparing it with diffHeadSha would leave CI unread. why 10 jobs: GitLab multiplies a
 * nested connection's cost by its size, and 10 keeps five branches inside the budget.
 */
const MR_FIELDS = `iid webUrl state draft approved approvedBy(first: 1) { nodes { id } } diffHeadSha
  headPipeline { status jobs(statuses: [FAILED, CANCELED], retried: false, first: 10) { nodes { name allowFailure } } }`;

/** Every branch's newest merge request on the project (null: none), read five branches a call, or why it couldn't be. why all or nothing: a failure is the host's, as one gh call's is. */
export async function readGitLab(run: RunCli, repo: GitLabRepo, branches: readonly string[]): Promise<BranchesRead> {
  const prs = new Map<string, PrSnapshot | null>();
  for (const chunk of chunksOf(branches, BRANCHES_PER_CALL)) {
    const read = await readChunk(run, repo, chunk);
    if (read.kind === "unavailable") return read;
    for (const [branch, pr] of read.prs) prs.set(branch, pr);
  }
  return { kind: "read", prs };
}

async function readChunk(run: RunCli, repo: GitLabRepo, branches: readonly string[]): Promise<BranchesRead> {
  let stdout: string;
  try {
    stdout = await run("glab", queryArgs(repo, branches));
  } catch (error) {
    return unavailable(glabFailure(repo.host, parseHostCommandFailure(error)));
  }
  const answer = parseAnswer(stdout, branches);
  switch (answer.kind) {
    case "read":
      return answer;
    // why persistent, and not "signed out": locate reads only once glab is signed in to the host, so the account can't see the project.
    case "no-project":
      return unavailable({ kind: "persistent", forge: "gitlab", reason: `glab is signed in to ${repo.host} but can't see \`${repo.path}\`: check the project's git remote, and that the account glab is signed in as can read it` });
    case "unreadable":
      return unavailable({ kind: "transient", forge: "gitlab", reason: `GitLab at ${repo.host} answered with something other than the merge requests the plugin asked for` });
    default:
      return answer satisfies never;
  }
}

function queryArgs({ host, path }: GitLabRepo, branches: readonly string[]): string[] {
  const variables = branches.map((_, i) => `$b${i}: String!`).join(", ");
  const fields = branches.map((_, i) => `b${i}: mergeRequests(sourceBranches: [$b${i}], sort: CREATED_DESC, first: 1) { nodes { ${MR_FIELDS} } }`).join("\n");
  const query = `query($path: ID!, ${variables}) { project(fullPath: $path) {\n${fields}\n} }`;
  return ["api", "graphql", "--hostname", host, "-f", `query=${query}`, "-f", `path=${path}`, ...branches.flatMap((branch, i) => ["-f", `b${i}=${branch}`])];
}

// why pending for the rest: CREATED, PREPARING, PENDING, RUNNING, CANCELING and any status GitLab adds later haven't finished, and one this plugin doesn't know is not a pass.
const PIPELINE_CI: Partial<Record<string, PrSnapshot["ci"]>> = { SUCCESS: "pass", FAILED: "fail", CANCELED: "fail", MANUAL: "blocked", SKIPPED: "none" };
// why locked is open: GitLab locks a merge request only while it merges it.
const STATE = { opened: "open", locked: "open", merged: "merged", closed: "closed" } as const;

const mrNodeSchema = z
  .object({
    iid: z.string().regex(/^\d+$/),
    webUrl: z.url(),
    state: z.enum(["opened", "locked", "merged", "closed"]),
    draft: z.boolean(),
    approved: z.boolean(),
    approvedBy: z.object({ nodes: z.array(z.unknown()) }),
    diffHeadSha: commitSchema,
    headPipeline: z.object({ status: z.string(), jobs: z.object({ nodes: z.array(z.object({ name: z.string(), allowFailure: z.boolean() })) }) }).nullable(),
  })
  .transform((mr): PrSnapshot => {
    const ci = mr.headPipeline === null ? "none" : (PIPELINE_CI[mr.headPipeline.status] ?? "pending");
    return {
      forge: "gitlab",
      number: Number(mr.iid),
      url: mr.webUrl,
      state: STATE[mr.state],
      draft: mr.draft,
      // why an approver too: `approved` is true when no approval is required at all.
      review: mr.approved && mr.approvedBy.nodes.length > 0 ? "approved" : "none",
      ci,
      headSha: mr.diffHeadSha,
      // why allowFailure jobs left out: they fail inside pipelines that pass (review.md: integration-tests, pages).
      failedChecks: ci === "fail" && mr.headPipeline !== null ? mr.headPipeline.jobs.nodes.filter((job) => !job.allowFailure).map((job) => job.name) : [],
    };
  });

const responseSchema = z.object({ data: z.object({ project: z.record(z.string(), z.object({ nodes: z.array(mrNodeSchema).max(1) })).nullable() }) });

type Answer = { kind: "read"; prs: Map<string, PrSnapshot | null> } | { kind: "no-project" } | { kind: "unreadable" };

/** Each branch's merge request from glab's answer to queryArgs; `no-project` when GitLab shows the account no such project. */
function parseAnswer(stdout: string, branches: readonly string[]): Answer {
  const parsed = responseSchema.safeParse(jsonOrNull(stdout));
  if (!parsed.success) return { kind: "unreadable" };
  const { project } = parsed.data.data;
  if (project === null) return { kind: "no-project" };
  const prs = new Map<string, PrSnapshot | null>();
  for (const [i, branch] of branches.entries()) {
    const field = project[`b${i}`];
    if (field === undefined) return { kind: "unreadable" };
    prs.set(branch, field.nodes[0] ?? null);
  }
  return { kind: "read", prs };
}

const unavailable = (why: PrUnavailable): BranchesRead => ({ kind: "unavailable", unavailable: why });

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
}

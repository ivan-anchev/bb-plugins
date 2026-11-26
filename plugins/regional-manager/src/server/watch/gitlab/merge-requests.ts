// The GitLab read the PR watch makes: each watched branch's newest merge request, its head
// pipeline and its review feedback, in one `glab api graphql --hostname H` call per five branches,
// its answer parsed at this boundary into snapshots. Every value goes as a `-f` variable, never
// into the query's text.
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

/**
 * The fields review feedback is read from, which a GitLab may lack: nobody has confirmed every host
 * the plugin reads has them (detailedMergeStatus came in GitLab 15.3). why the counts and not
 * DetailedMergeStatus alone: GitLab reports only the first failing check, and its draft check comes
 * before its discussions check, so a draft merge request would hide its unresolved discussions.
 */
const FEEDBACK_FIELDS = "detailedMergeStatus resolvableDiscussionsCount resolvedDiscussionsCount";

// GitLab's GraphQL error for a feedback field its schema doesn't have, as glab prints it on stderr.
const FEEDBACK_GAP = /Field '(?:detailedMergeStatus|resolvableDiscussionsCount|resolvedDiscussionsCount)' doesn't exist on type/;

/** Reads a GitLab project's branches: every branch's newest merge request (null: none), or why it couldn't be read. */
type ReadGitLab = (repo: GitLabRepo, branches: readonly string[]) => Promise<BranchesRead>;

/**
 * The GitLab reader of one plugin instance. A host whose GitLab lacks a feedback field is read
 * without them from then on, its merge requests still read, CI gate and merges included, with no
 * review feedback but approval. why remembered for the plugin's life: a GitLab gains a field only
 * by an upgrade, and asking for it each tick would fail one call a minute.
 */
export function createGitLabReader(run: RunCli): ReadGitLab {
  const withoutFeedback = new Set<string>();

  /** Every branch's newest merge request, read five branches a call. why all or nothing: a failure is the host's, as one gh call's is. */
  async function read(repo: GitLabRepo, branches: readonly string[]): Promise<BranchesRead> {
    const prs = new Map<string, PrSnapshot | null>();
    for (const chunk of chunksOf(branches, BRANCHES_PER_CALL)) {
      const chunkRead = await readChunk(repo, chunk);
      if (chunkRead.kind === "unavailable") return chunkRead;
      for (const [branch, pr] of chunkRead.prs) prs.set(branch, pr);
    }
    return { kind: "read", prs };
  }

  /** One call's branches; once more without the feedback fields when GitLab says it lacks one. */
  async function readChunk(repo: GitLabRepo, branches: readonly string[]): Promise<BranchesRead> {
    const feedback = !withoutFeedback.has(repo.host);
    let stdout: string;
    try {
      stdout = await run("glab", queryArgs(repo, branches, feedback));
    } catch (error) {
      const failure = parseHostCommandFailure(error);
      if (!feedback || !FEEDBACK_GAP.test(failure.stderr)) return unavailable(glabFailure(repo.host, failure));
      withoutFeedback.add(repo.host);
      return readChunk(repo, branches);
    }
    return answerRead(repo, parseAnswer(stdout, branches));
  }

  return read;
}

/** A parsed answer as the read it makes, a project GitLab doesn't show or an answer it can't read saying why. */
function answerRead(repo: GitLabRepo, answer: Answer): BranchesRead {
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

function queryArgs({ host, path }: GitLabRepo, branches: readonly string[], feedback: boolean): string[] {
  const variables = branches.map((_, i) => `$b${i}: String!`).join(", ");
  const selection = feedback ? `${MR_FIELDS}\n  ${FEEDBACK_FIELDS}` : MR_FIELDS;
  const fields = branches.map((_, i) => `b${i}: mergeRequests(sourceBranches: [$b${i}], sort: CREATED_DESC, first: 1) { nodes { ${selection} } }`).join("\n");
  const query = `query($path: ID!, ${variables}) { project(fullPath: $path) {\n${fields}\n} }`;
  return ["api", "graphql", "--hostname", host, "-f", `query=${query}`, "-f", `path=${path}`, ...branches.flatMap((branch, i) => ["-f", `b${i}=${branch}`])];
}

// why pending for the rest: CREATED, PREPARING, PENDING, RUNNING, CANCELING and any status GitLab adds later haven't finished, and one this plugin doesn't know is not a pass.
const PIPELINE_CI: Partial<Record<string, PrSnapshot["ci"]>> = { SUCCESS: "pass", FAILED: "fail", CANCELED: "fail", MANUAL: "blocked", SKIPPED: "none" };
// why locked is open: GitLab locks a merge request only while it merges it.
const STATE = { opened: "open", locked: "open", merged: "merged", closed: "closed" } as const;

/** A merge request node as GitLab answers the selection, the feedback fields null when it left them out. */
const mrFieldsSchema = z.object({
  iid: z.string().regex(/^\d+$/),
  webUrl: z.url(),
  state: z.enum(["opened", "locked", "merged", "closed"]),
  draft: z.boolean(),
  approved: z.boolean(),
  approvedBy: z.object({ nodes: z.array(z.unknown()) }),
  diffHeadSha: commitSchema,
  // why a default: the read leaves them out on a GitLab that lacks one (createGitLabReader).
  detailedMergeStatus: z.string().nullable().default(null),
  resolvableDiscussionsCount: z.number().int().nullable().default(null),
  resolvedDiscussionsCount: z.number().int().nullable().default(null),
  headPipeline: z.object({ status: z.string(), jobs: z.object({ nodes: z.array(z.object({ name: z.string(), allowFailure: z.boolean() })) }) }).nullable(),
});
type MrNode = z.output<typeof mrFieldsSchema>;

const mrNodeSchema = mrFieldsSchema.transform((mr): PrSnapshot => {
  const ci = mr.headPipeline === null ? "none" : (PIPELINE_CI[mr.headPipeline.status] ?? "pending");
  return {
    forge: "gitlab",
    number: Number(mr.iid),
    url: mr.webUrl,
    state: STATE[mr.state],
    draft: mr.draft,
    review: reviewOf(mr),
    ci,
    headSha: mr.diffHeadSha,
    // why allowFailure jobs left out: they fail inside pipelines that pass (review.md: integration-tests, pages).
    failedChecks: ci === "fail" && mr.headPipeline !== null ? mr.headPipeline.jobs.nodes.filter((job) => !job.allowFailure).map((job) => job.name) : [],
  };
});

/**
 * A merge request's review feedback, the blocking first. why an approver too: `approved` is true
 * when no approval is required at all. Neither a discussion's text nor its author is read: the
 * counts are enough.
 */
function reviewOf(mr: MrNode): PrSnapshot["review"] {
  if (mr.detailedMergeStatus === "REQUESTED_CHANGES") return "changes-requested";
  if ((mr.resolvableDiscussionsCount ?? 0) > (mr.resolvedDiscussionsCount ?? 0)) return "unresolved-discussions";
  return mr.approved && mr.approvedBy.nodes.length > 0 ? "approved" : "none";
}

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

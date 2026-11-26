import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrSnapshot } from "../../../model/verdict/pr.ts";
import type { Cli } from "../host-command.ts";
import { readGitLab } from "./merge-requests.ts";

const HOST = "gitlab.corp.test";
const REPO = { forge: "gitlab", host: HOST, path: "frontend/station-ws" } as const;
const HEAD = "a".repeat(40);

type Node = { iid?: string; state?: string; draft?: boolean; approved?: boolean; approvers?: number; pipeline?: { status: string; jobs?: { name: string; allowFailure: boolean }[] } | null };

/** GitLab's merge request node, as GitLab's GraphQL answers the watch's selection: iid a string, the state lower case. */
const node = ({ iid = "41", state = "opened", draft = false, approved = false, approvers = 0, pipeline = null }: Node) => ({
  iid,
  webUrl: `https://${HOST}/frontend/station-ws/-/merge_requests/${iid}`,
  state,
  draft,
  approved,
  approvedBy: { nodes: approvers > 0 ? [{ id: "gid://gitlab/User/7" }] : [] },
  diffHeadSha: HEAD,
  headPipeline: pipeline === null ? null : { status: pipeline.status, jobs: { nodes: pipeline.jobs ?? [] } },
});

/** glab answering each `api graphql` run with each aliased branch's node from `nodes` (absent: no merge request); every run's arguments. */
function glabAnswering(nodes: ReadonlyMap<string, Node>) {
  const runs: string[][] = [];
  const run = async (cli: Cli, args: string[]) => {
    assert.equal(cli, "glab");
    runs.push(args);
    const branches = args.flatMap((arg) => {
      const match = /^(b\d+)=(.*)$/s.exec(arg);
      return match === null ? [] : [[match[1] ?? "", match[2] ?? ""] as const];
    });
    return JSON.stringify({ data: { project: Object.fromEntries(branches.map(([alias, branch]) => [alias, { nodes: nodes.has(branch) ? [node(nodes.get(branch) ?? {})] : [] }])) } });
  };
  return { run, runs };
}

/** The merge request readGitLab read for one branch whose node is `fields`. */
async function one(fields: Node): Promise<PrSnapshot | null> {
  const read = await readGitLab(glabAnswering(new Map([["feat", fields]])).run, REPO, ["feat"]);
  return read.kind === "read" ? (read.prs.get("feat") ?? null) : assert.fail(read.unavailable.reason);
}

test("a GitLab merge request reads as a snapshot on GitLab: its iid a number, its URL, its head, locked as open", async () => {
  assert.deepEqual(await one({}), { forge: "gitlab", number: 41, url: `https://${HOST}/frontend/station-ws/-/merge_requests/41`, state: "open", draft: false, review: "none", ci: "none", headSha: HEAD, failedChecks: [] });
  assert.deepEqual(
    await Promise.all(["opened", "locked", "merged", "closed"].map(async (state) => (await one({ state }))?.state)),
    ["open", "open", "merged", "closed"],
  );
  assert.equal((await one({ draft: true }))?.draft, true);
});

test("a GitLab merge request is approved only with an approver: approved alone means none is required", async () => {
  assert.equal((await one({ approved: true, approvers: 1 }))?.review, "approved");
  assert.equal((await one({ approved: true, approvers: 0 }))?.review, "none");
  assert.equal((await one({ approved: false, approvers: 1 }))?.review, "none", "an approver with more approvals still required");
});

test("a GitLab head pipeline's status is the merge request's CI: a manual job blocks it, an unknown status is pending, skipped or none is no checks", async () => {
  const ciOf = async (status: string | null) => (await one({ pipeline: status === null ? null : { status } }))?.ci;
  const cases: [string | null, PrSnapshot["ci"]][] = [
    [null, "none"],
    ["SKIPPED", "none"],
    ["SUCCESS", "pass"],
    ["FAILED", "fail"],
    ["CANCELED", "fail"],
    ["MANUAL", "blocked"],
    ["RUNNING", "pending"],
    ["CREATED", "pending"],
    ["WAITING_FOR_RESOURCE", "pending"],
    ["SCHEDULED", "pending"],
    ["SOMETHING_NEW", "pending"],
  ];
  for (const [status, ci] of cases) assert.equal(await ciOf(status), ci, String(status));
});

test("a failed GitLab pipeline names its failed and canceled jobs, never one allowed to fail; a passing one names none", async () => {
  const jobs = [
    { name: "unit-tests", allowFailure: false },
    { name: "integration-tests", allowFailure: true },
    { name: "eslint", allowFailure: false },
  ];
  assert.deepEqual((await one({ pipeline: { status: "FAILED", jobs } }))?.failedChecks, ["unit-tests", "eslint"]);
  assert.deepEqual((await one({ pipeline: { status: "SUCCESS", jobs: [{ name: "pages", allowFailure: true }] } }))?.failedChecks, []);
});

test("GitLab is read five branches a call with --hostname, the project and every branch as variables, never in the query's text", async () => {
  const branches = Array.from({ length: 12 }, (_, i) => `feat/${i} "quoted" }`);
  const glab = glabAnswering(new Map(branches.map((branch, i) => [branch, { iid: String(i + 1) }])));
  const read = await readGitLab(glab.run, REPO, branches);
  assert.deepEqual(read.kind === "read" ? [...read.prs.values()].map((pr) => pr?.number) : null, branches.map((_, i) => i + 1));
  assert.deepEqual(glab.runs.map((args) => args.filter((arg) => /^b\d+=/.test(arg)).length), [5, 5, 2]);
  for (const args of glab.runs) {
    assert.deepEqual(args.slice(0, 4), ["api", "graphql", "--hostname", HOST]);
    assert.ok(args.includes("path=frontend/station-ws"));
    const query = args.find((arg) => arg.startsWith("query=")) ?? assert.fail("no query");
    assert.ok(!query.includes("quoted") && !query.includes("station-ws"), "no value in the query's text");
    assert.doesNotMatch(query, /\bsha\b/, "no pipeline sha: a merged-results pipeline runs on another");
  }
});

/** What a glab run that exited 1 with this on stderr (and stdout) makes the read say. */
async function failedWith(failure: object) {
  const run = async () => {
    throw Object.assign(new Error("Command failed: glab api graphql"), failure);
  };
  const read = await readGitLab(run, REPO, ["feat"]);
  return read.kind === "unavailable" ? read.unavailable : assert.fail("read");
}
const said = (stderr: string, stdout = "") => failedWith({ code: 1, stdout, stderr: `${stderr}\n` });

test("a GitLab read that can't succeed until someone acts says why and lasts, naming the host", async () => {
  const cases: [string, Promise<unknown>, string][] = [
    ["glab missing", failedWith({ code: "ENOENT" }), `glab, the GitLab CLI, isn't installed on the machine running bb, so it can't read GitLab at ${HOST}`],
    ["sign-in failed", said(`glab: the token for "${HOST}" is missing from the operating system keyring; run \`glab auth login --hostname ${HOST}\` to re-authenticate`), `glab isn't signed in to ${HOST} on the machine running bb: run glab auth login --hostname ${HOST} there`],
    ["credentials rejected", said("glab: 401 Unauthorized (HTTP 401)", '{"message":"401 Unauthorized"}'), `GitLab at ${HOST} rejected glab's credentials (HTTP 401): run glab auth login --hostname ${HOST} on the machine running bb`],
    ["credentials rejected, with no message", said("glab: HTTP 401"), `GitLab at ${HOST} rejected glab's credentials (HTTP 401): run glab auth login --hostname ${HOST} on the machine running bb`],
    ["a field GitLab's schema lacks", said("glab: Field 'draft' doesn't exist on type 'MergeRequest'"), `GitLab at ${HOST} lacks a field the plugin's query reads, so it is older than the plugin reads`],
  ];
  for (const [name, read, reason] of cases) assert.deepEqual(await read, { kind: "persistent", forge: "gitlab", reason }, name);
});

test("a GitLab project the signed-in account can't see lasts, naming the host and the project", async () => {
  const read = await readGitLab(async () => JSON.stringify({ data: { project: null } }), REPO, ["feat"]);
  assert.deepEqual(read, { kind: "unavailable", unavailable: { kind: "persistent", forge: "gitlab", reason: `glab is signed in to ${HOST} but can't see \`frontend/station-ws\`: check the project's git remote, and that the account glab is signed in as can read it` } });
});

test("a GitLab read that may succeed next time says why, naming the host: a timeout, a connection that never answered, a rate limit, and glab's own first line for anything else", async () => {
  const cases: [string, Promise<unknown>, string][] = [
    ["a timeout", failedWith({ code: null, killed: true }), `couldn't reach GitLab at ${HOST}`],
    ["a transport error", said(`Post "https://${HOST}/api/graphql": dial tcp: lookup ${HOST}: no such host`), `couldn't reach GitLab at ${HOST}`],
    ["a rate limit", said(`glab: rate limited by throttle_authenticated_api, retry after 30s\nglab: HTTP 429`), `GitLab at ${HOST} is limiting requests right now`],
    ["anything unexplained", said("glab: Internal server error (HTTP 500)"), `glab couldn't read GitLab at ${HOST}: Internal server error (HTTP 500)`],
    ["glab silent", failedWith({ code: 2, stderr: "" }), `glab couldn't read GitLab at ${HOST}: glab failed with no message (exit 2)`],
  ];
  for (const [name, read, reason] of cases) assert.deepEqual(await read, { kind: "transient", forge: "gitlab", reason }, name);
  const unreadable = await readGitLab(async () => "<html>", REPO, ["feat"]);
  assert.deepEqual(unreadable, { kind: "unavailable", unavailable: { kind: "transient", forge: "gitlab", reason: `GitLab at ${HOST} answered with something other than the merge requests the plugin asked for` } });
});

test("a GitLab read with one call failing is unavailable whole, and its later calls never run", async () => {
  let calls = 0;
  const run = async () => {
    calls += 1;
    throw Object.assign(new Error("Command failed: glab api graphql"), { code: 1, stdout: "", stderr: "glab: HTTP 502\n" });
  };
  const read = await readGitLab(run, REPO, ["a", "b", "c", "d", "e", "f"]);
  assert.equal(read.kind, "unavailable");
  assert.equal(calls, 1);
});

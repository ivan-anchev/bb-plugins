import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorContract } from "../../../contract.ts";
import { laneOf } from "../../../model/board/board-groups.ts";
import { prRef } from "../../../model/verdict/pr.ts";
import { assertQuotedHostileName, coordinating, doorbellOf, HOSTILE_CHECK_NAME, settled, startedAgent, textOf, type FakeMr } from "../../test-harness.ts";

const STATION_WS = "ssh://git@gitlab.corp.test:8022/frontend/station-ws.git";
const HOST = "gitlab.corp.test";
const MR_URL = `https://${HOST}/frontend/station-ws/-/merge_requests/41`;
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const DONE = { status: "done", summary: "Retries land with backoff", did: ["Added backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [], headSha: HEAD, prUrl: MR_URL };
const PASSES = {
  headSha: HEAD,
  criteria: [
    { criterion: 1, result: "pass", shows: "Ran it.", evidence: "$ npm test\n# fail 0" },
    { criterion: 2, result: "pass", shows: "Ran it.", evidence: "$ npm run lint\n0 problems" },
  ],
  findings: [],
};
const MINUTE = 60_000;

/** A regional manager with one agent on a GitLab project (station-ws's remote, glab signed in to its host unless `signedIn` is false), both idle. */
async function agentOnGitLab({ remote = STATION_WS, host = HOST, project = "frontend/station-ws", signedIn = true } = {}) {
  const { kit, threadId, coordinatorId } = await coordinating();
  kit.project.remote = remote;
  kit.gitlab.project = project;
  if (signedIn) kit.gitlab.hosts.set(host, { state: "success" });
  const agentThreadId = (await startedAgent(kit, threadId, { title: "Add retries", brief: "Retry failed deliveries.", doneCriteria: ["npm test passes", "npm run lint is clean"] })).agentThreadId;
  kit.thread(threadId).status = "idle";
  const branch = kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch");
  // why parsed: the app reads the board through the contract, as bb hands it over.
  const board = async () => coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId }));
  const row = async () => {
    const issue = (await board()).issues[0] ?? assert.fail("no row");
    const { headline, pr } = issue;
    return { lane: laneOf(issue), headline, pr: pr === null ? null : `${prRef(pr)} ${pr.state} CI ${pr.ci}` };
  };
  /** GitLab now has the agent's merge request !41 as given, its pipeline running unless given. */
  const mr = (fields: Partial<FakeMr> = {}) => kit.gitlab.mrs.set(branch, { iid: 41, state: "opened", draft: false, approved: false, approvers: 0, detailedMergeStatus: "CI_STILL_RUNNING", resolvableDiscussionsCount: 0, resolvedDiscussionsCount: 0, head: HEAD, pipeline: { status: "RUNNING", jobs: [] }, ...fields });
  /** Each glab run so far, its arguments joined. */
  const glabRuns = () => kit.gitlab.runs.map((args) => args.join(" "));
  async function minute(): Promise<void> {
    kit.clock.now += MINUTE;
    await kit.tick();
    await settled();
  }
  /** The agent hands off as done, naming its merge request, and its verifier passes every criterion. */
  async function verified(): Promise<void> {
    await kit.call("agent_handoff", DONE, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
    const verdict = kit.store.latestHandoff(coordinatorId, kit.store.agents(coordinatorId)[0]?.id ?? assert.fail("no agent"))?.check?.verdict;
    if (verdict?.state !== "running") return assert.fail("no running verifier");
    await kit.call("issue_verdict", PASSES, verdict.verifierThreadId);
    await settled();
  }
  /** The changes of each `pr` entry in the issue's feed, oldest first: one per change the watch recorded. */
  async function prChanges(): Promise<string[][]> {
    const issueId = kit.store.issues(coordinatorId)[0]?.id ?? assert.fail("no issue");
    const { feed } = await kit.opened(coordinatorId, issueId);
    return feed.entries.flatMap((entry) => (entry.kind === "pr" ? [entry.changes] : []));
  }
  return { kit, threadId, coordinatorId, agentThreadId, branch, board, row, mr, glabRuns, minute, verified, prChanges };
}

test(`GitLab on ${STATION_WS}: the merge request shows as !41, a done verdict waits while its pipeline is RUNNING, and passes on SUCCESS`, async () => {
  const { kit, threadId, board, row, mr, minute, verified } = await agentOnGitLab();
  mr();
  await minute();
  assert.deepEqual(await row(), { lane: "in-progress", headline: "Working", pr: "!41 open CI pending" });
  assert.equal(kit.doorbellsSent(threadId).at(-1), doorbellOf('WEB-1 "Add retries" (a1) MR !41: opened'));
  await verified();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on !41: Retries land with backoff", pr: "!41 open CI pending" });
  await minute();
  assert.equal((await row()).lane, "verifying", "RUNNING: still waiting");
  mr({ pipeline: { status: "SUCCESS", jobs: [{ name: "pages", allowFailure: true }] } });
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "!41 open CI pass" });
  const issue = (await board()).issues[0];
  assert.equal(issue?.pr?.url, MR_URL, "the badge links to the merge request");
  assert.equal(issue?.pr?.forge, "gitlab");
});

test(`GitLab on ${STATION_WS}: a FAILED pipeline fails the verdict with CI failed on !41, naming the failed job and never one allowed to fail`, async () => {
  const { kit, agentThreadId, row, mr, minute, verified } = await agentOnGitLab();
  mr();
  await minute();
  await verified();
  mr({ pipeline: { status: "FAILED", jobs: [{ name: "unit-tests", allowFailure: false }, { name: "integration-tests", allowFailure: true }] } });
  await minute();
  const findings = kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent");
  assert.match(findings, /^## Verifier findings: CI failed on !41, though every done-criterion passed\n/);
  assert.match(findings, /### CI failed on !41\n\nFailed checks on this commit: `unit-tests`\. Read the runs on the merge request, fix the cause, and push\./);
  assert.doesNotMatch(findings, /integration-tests/);
  assert.equal((await row()).lane, "in-progress", "the agent works on its fix");
});

test(`GitLab on ${STATION_WS}: a merged merge request makes the issue Done with Merged !41`, async () => {
  const { kit, row, mr, minute, verified } = await agentOnGitLab();
  mr({ pipeline: { status: "SUCCESS", jobs: [] } });
  await minute();
  await verified();
  mr({ state: "merged", pipeline: { status: "SUCCESS", jobs: [] } });
  kit.clock.now += 4 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged !41", pr: "!41 merged CI pass" });
});

test("manual: a pipeline blocked on a manual job on the handed-off commit passes with CI not checked, saying why, and isn't read again for 5 minutes", async () => {
  const { kit, threadId, row, mr, glabRuns, minute, verified } = await agentOnGitLab();
  mr();
  await minute();
  mr({ pipeline: { status: "MANUAL", jobs: [] } });
  await minute();
  assert.deepEqual(await row(), { lane: "in-progress", headline: "Working", pr: "!41 open CI blocked" });
  await verified();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: "!41 open CI blocked" });
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /CI: not checked \(!41's pipeline is blocked on a manual job nobody has played\)\./);
  const runs = glabRuns().length;
  for (let i = 0; i < 4; i++) await minute();
  assert.equal(glabRuns().length, runs, "nothing runs until a person plays the job: the quiet interval");
  await minute();
  assert.deepEqual(glabRuns().slice(runs), [glabRuns().at(-1)], "read again once 5 minutes passed");
  assert.match(glabRuns().at(-1) ?? "", /^api graphql --hostname gitlab\.corp\.test /);
});

test("sign-in: glab is asked about the host once and read every tick; a read that fails makes the next tick ask again", async () => {
  const { kit, mr, glabRuns, minute } = await agentOnGitLab();
  mr();
  await minute();
  await minute();
  const kinds = () => glabRuns().map((run) => (run.startsWith("auth status") ? run : run.split(" -f ")[0]));
  assert.deepEqual(kinds(), [`auth status --hostname ${HOST} --output json`, `api graphql --hostname ${HOST}`, `api graphql --hostname ${HOST}`]);
  kit.gitlab.failure = Object.assign(new Error("Command failed: glab api graphql"), { code: 1, stdout: "", stderr: "glab: HTTP 502\n" });
  await minute();
  kit.gitlab.failure = null;
  await minute();
  assert.deepEqual(kinds().slice(3), [`api graphql --hostname ${HOST}`, `auth status --hostname ${HOST} --output json`, `api graphql --hostname ${HOST}`]);
});

test("sign-in: a gitlab.com remote is read the same way, through glab signed in to gitlab.com", async () => {
  const { row, mr, glabRuns, minute } = await agentOnGitLab({ remote: "https://gitlab.com/acme/webhooks.git", host: "gitlab.com", project: "acme/webhooks" });
  mr();
  await minute();
  assert.deepEqual(await row(), { lane: "in-progress", headline: "Working", pr: "!41 open CI pending" });
  assert.deepEqual(
    glabRuns().map((run) => (run.startsWith("auth status") ? run : run.split(" -f ")[0])),
    ["auth status --hostname gitlab.com --output json", "api graphql --hostname gitlab.com"],
  );
});

test("sign-in: GitLab rejecting glab's credentials shows MR status unavailable naming the host, and a verdict waiting on CI passes with CI not checked", async () => {
  const { kit, board, row, mr, minute, verified } = await agentOnGitLab();
  mr();
  await minute();
  await verified();
  kit.gitlab.hosts.set(HOST, { state: "error", error: `GET https://${HOST}/api/v4/user: 401 {message: 401 Unauthorized}` });
  await minute();
  const rejected = `GitLab at ${HOST} rejected glab's credentials (HTTP 401): run glab auth login --hostname ${HOST} on the machine running bb`;
  assert.deepEqual((await board()).prUnavailable, { forge: "gitlab", reason: rejected });
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: "!41 open CI pending" });
});

test("a project on a host glab isn't signed in to is never read; a verdict waiting on its merge request passes with CI not checked, saying why", async () => {
  const { kit, board, row, glabRuns, minute, verified } = await agentOnGitLab({ signedIn: false });
  await minute();
  await verified();
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: null });
  assert.deepEqual((await board()).prUnavailable, { forge: null, reason: `${HOST} isn't github.com, and glab on the machine running bb isn't signed in to it: if it is a GitLab, run glab auth login --hostname ${HOST} there` });
  assert.ok(glabRuns().every((run) => run.startsWith("auth status")), "only asked whether it is signed in");
  assert.deepEqual(kit.github.runs, []);
});

test("sign-in: before any handoff, the board says glab isn't signed in to the project's host, naming it", async () => {
  const { board, minute } = await agentOnGitLab({ signedIn: false });
  await minute();
  assert.deepEqual((await board()).prUnavailable, { forge: null, reason: `${HOST} isn't github.com, and glab on the machine running bb isn't signed in to it: if it is a GitLab, run glab auth login --hostname ${HOST} there` });
});

test("sign-in: a rate limit on the read and then on glab's sign-in check keeps a verdict waiting for CI, and it settles on the pipeline once GitLab answers", async () => {
  const { kit, board, row, mr, minute, verified } = await agentOnGitLab();
  mr();
  await minute();
  await verified();
  kit.gitlab.failure = Object.assign(new Error("Command failed: glab api graphql"), { code: 1, stdout: "", stderr: "glab: Too Many Requests (HTTP 429)\n" });
  await minute();
  kit.gitlab.failure = null;
  kit.gitlab.hosts.set(HOST, { state: "error", error: `GET https://${HOST}/api/v4/user: 429 {message: Too Many Requests}` });
  await minute();
  const waiting = { lane: "verifying", headline: "Waiting for CI on !41: Retries land with backoff", pr: "!41 open CI pending" };
  assert.deepEqual(await row(), waiting);
  assert.deepEqual((await board()).prUnavailable, { forge: "gitlab", reason: `GitLab at ${HOST} is limiting requests right now` });
  kit.gitlab.hosts.set(HOST, { state: "success" });
  mr({ pipeline: { status: "SUCCESS", jobs: [] } });
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "!41 open CI pass" });
});

test("check names: a GitLab job named with a backtick, a line break, U+202E and 300 characters reaches the agent's findings and the manager's catch-up as one capped code span", async () => {
  const { kit, threadId, agentThreadId, mr, minute, verified } = await agentOnGitLab();
  mr();
  await minute();
  await verified();
  mr({ pipeline: { status: "FAILED", jobs: [{ name: HOSTILE_CHECK_NAME, allowFailure: false }] } });
  await minute();
  assertQuotedHostileName(kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent"), "the agent's findings");
  assertQuotedHostileName(textOf(await kit.call("crew_catch_up", {}, threadId)), "catch-up");
});

test("discussions: a draft merge request with 2 resolvable discussions and 1 resolved puts MR !41: unresolved discussions in the doorbell and catch-up, once, and resolving them records nothing", async () => {
  const { kit, threadId, mr, minute, prChanges } = await agentOnGitLab();
  const draft = { draft: true, detailedMergeStatus: "DRAFT_STATUS" };
  mr(draft);
  await minute();
  mr({ ...draft, resolvableDiscussionsCount: 2, resolvedDiscussionsCount: 1 });
  await minute();
  assert.equal(kit.doorbellsSent(threadId).at(-1), doorbellOf('WEB-1 "Add retries" (a1) MR !41: unresolved discussions'));
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /MR !41: unresolved discussions/);
  assert.deepEqual(await prChanges(), [["opened"], ["unresolved-discussions"]], "the issue's feed: !41 unresolved discussions");
  const doorbells = kit.doorbellsSent(threadId).length;
  await minute();
  mr({ ...draft, resolvableDiscussionsCount: 2, resolvedDiscussionsCount: 2 });
  await minute();
  assert.deepEqual(await prChanges(), [["opened"], ["unresolved-discussions"]], "the same counts again, then every discussion resolved: no new entry");
  assert.equal(kit.doorbellsSent(threadId).length, doorbells);
});

test("discussions: requested changes read changes requested even with unresolved discussions, an approval with no approver records nothing, and an approver with every discussion resolved reads approved", async () => {
  const { kit, threadId, mr, minute, prChanges } = await agentOnGitLab();
  mr();
  await minute();
  mr({ approved: true, approvers: 0, resolvableDiscussionsCount: 1, resolvedDiscussionsCount: 1 });
  await minute();
  assert.deepEqual(await prChanges(), [["opened"]], "approved with an empty approvedBy: no review change");
  mr({ detailedMergeStatus: "REQUESTED_CHANGES", resolvableDiscussionsCount: 2, resolvedDiscussionsCount: 0 });
  await minute();
  assert.equal(kit.doorbellsSent(threadId).at(-1), doorbellOf('WEB-1 "Add retries" (a1) MR !41: changes requested'));
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /MR !41: changes requested/);
  mr({ approved: true, approvers: 1, detailedMergeStatus: "MERGEABLE", resolvableDiscussionsCount: 2, resolvedDiscussionsCount: 2 });
  await minute();
  assert.equal(kit.doorbellsSent(threadId).at(-1), doorbellOf('WEB-1 "Add retries" (a1) MR !41: approved'));
  assert.deepEqual(await prChanges(), [["opened"], ["changes-requested"], ["approved"]]);
});

test("discussions: on an older GitLab whose schema lacks the discussion counts, the merge request is still read, its CI gates the verdict and its merge makes the issue Done, with no review feedback and nothing unavailable", async () => {
  const { kit, board, row, mr, glabRuns, minute, verified, prChanges } = await agentOnGitLab();
  kit.gitlab.lacks = new Set(["resolvableDiscussionsCount", "resolvedDiscussionsCount"]);
  const discussed = { draft: true, detailedMergeStatus: "DRAFT_STATUS", resolvableDiscussionsCount: 2, resolvedDiscussionsCount: 0 };
  mr(discussed);
  await minute();
  assert.deepEqual(await row(), { lane: "in-progress", headline: "Working", pr: "!41 open CI pending" });
  assert.equal((await board()).prUnavailable, null);
  await verified();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on !41: Retries land with backoff", pr: "!41 open CI pending" });
  mr({ ...discussed, pipeline: { status: "SUCCESS", jobs: [] } });
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "!41 open CI pass" });
  mr({ ...discussed, state: "merged", pipeline: { status: "SUCCESS", jobs: [] } });
  kit.clock.now += 4 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged !41", pr: "!41 merged CI pass" });
  assert.equal((await board()).prUnavailable, null);
  assert.deepEqual(await prChanges(), [["opened"], ["ci-passed"], ["merged"]], "no unresolved discussions reported for that host");
  const reads = glabRuns().filter((run) => run.startsWith("api graphql"));
  assert.deepEqual(
    reads.map((run) => run.includes("resolvableDiscussionsCount")),
    [true, ...reads.slice(1).map(() => false)],
    "asked for the counts once; every later read leaves them out",
  );
  assert.equal(glabRuns().filter((run) => run.startsWith("auth status")).length, 1, "the fallback isn't a failed read: the sign-in isn't asked again");
});

test("older: a GitLab whose schema lacks a field the read needs shows MR status unavailable naming the host, and a done verdict waiting on its merge request settles with CI not checked", async () => {
  const { kit, board, row, mr, minute, verified } = await agentOnGitLab();
  kit.gitlab.lacks = new Set(["draft"]);
  mr();
  await minute();
  assert.deepEqual((await board()).prUnavailable, { forge: "gitlab", reason: `GitLab at ${HOST} lacks a field the plugin's query reads, so it is older than the plugin reads` });
  await verified();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: null });
});

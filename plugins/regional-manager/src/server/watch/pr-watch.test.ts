import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { coordinating, doorbellOf, failsVerification, isRefusal, settled, startedAgent, textOf, withoutLinks, type FakePr } from "../test-harness.ts";

const a1 = agentIdSchema.parse("a1");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const PR_URL = "https://github.com/acme/webhooks/pull/41";
const BLOCKED = { status: "blocked", summary: "Needs the retry budget", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
const DONE = { status: "done", summary: "Retries land with backoff", did: ["Added backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [], headSha: HEAD };
const PASSES = {
  headSha: HEAD,
  criteria: [
    { criterion: 1, result: "pass", evidence: "$ npm test\n# fail 0" },
    { criterion: 2, result: "pass", evidence: "$ npm run lint\n0 problems" },
  ],
  findings: [],
};
const MINUTE = 60_000;

/** The rejection of a real gh run, recorded in fixtures/gh-failures. */
const recorded = (name: string) => Object.assign(new Error("Command failed: gh api graphql"), JSON.parse(readFileSync(new URL(`./fixtures/gh-failures/${name}.json`, import.meta.url), "utf8")));
/** A gh run that failed with this on stderr. */
const ghSaid = (stderr: string) => Object.assign(new Error("Command failed: gh api graphql"), { code: 1, stdout: "", stderr: `${stderr}\n` });

/** A regional manager with one agent on a GitHub project, both idle; the agent's branch and what the plugin shows of it. */
async function agentOnGitHub(placement: object = { kind: "worktree" }) {
  const { kit, threadId, coordinatorId } = await coordinating();
  const agentThreadId = (await startedAgent(kit, threadId, { title: "Add retries", brief: "Retry failed deliveries.", doneCriteria: ["npm test passes", "npm run lint is clean"] }, { placement })).agentThreadId;
  kit.thread(threadId).status = "idle";
  const branch = kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch");
  const board = () => kit.rpc.board({ coordinatorId });
  const row = async () => {
    const issue = (await board()).issues[0] ?? assert.fail("no row");
    const { headline, pr } = issue;
    return { lane: laneOf(issue), headline, pr: pr === null ? null : `#${pr.number} ${pr.state} CI ${pr.ci}` };
  };
  const doorbells = () => kit.doorbellsSent(threadId);
  const events = () => kit.store.unannounced(coordinatorId).map(({ event }) => event.kind);
  /** GitHub now has the agent's pull request #41 as given, on its branch as bb records it unless `onBranch` names another. */
  const pr = (fields: Partial<FakePr> = {}, onBranch = branch) => kit.github.prs.set(onBranch, { number: 41, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: "PENDING", failed: [], ...fields });
  /** A minute passes and the schedule runs. */
  async function minute(): Promise<void> {
    kit.clock.now += MINUTE;
    await kit.tick();
    await settled();
  }
  /** The agent hands off as done, naming its pull request, and its verifier passes every criterion. */
  async function verified(): Promise<void> {
    await kit.call("agent_handoff", { ...DONE, prUrl: PR_URL }, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
    const verdict = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
    if (verdict?.state !== "running") return assert.fail("no running verifier");
    await kit.call("issue_verdict", PASSES, verdict.verifierThreadId);
    await settled();
  }
  return { kit, threadId, coordinatorId, agentThreadId, branch, board, row, doorbells, events, pr, minute, verified };
}

test("an agent that opens a pull request shows #n on its row within a tick, and the coordinating thread gets a pr event", async () => {
  const { kit, threadId, row, doorbells, pr, minute } = await agentOnGitHub();
  await minute();
  assert.equal((await row()).pr, null, "no pull request yet");

  pr();
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.equal((await row()).pr, "#41 open CI pending");
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /- WEB-1 "Add retries" \(a1\) PR #41: opened$/);
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /### WEB-1 "Add retries" \(a1\) PR #41: opened\n\nAt [^\n]* It is open \(https:\/\/github\.com\/acme\/webhooks\/pull\/41\), with no approval or change request; CI on its head 0123456: still running\./);
});

test("a verdict that passes while CI is pending waits under Verifying as waiting for CI, then goes to In review the tick CI passes", async () => {
  const { kit, threadId, row, doorbells, events, pr, minute, verified } = await agentOnGitHub();
  pr();
  await minute();
  await verified();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pending" });
  const before = doorbells().length;
  await minute();
  assert.equal(doorbells().length, before, "a verdict waiting for CI wakes nobody");

  // why hold WEB-1's turn: the verdict settles in it, which the tick starts and doesn't wait for, so
  // nothing orders it before the tick's ring. Held, it is still settling as the tick rings.
  pr({ rollup: "SUCCESS" });
  kit.turnsTaken.holding = true;
  await minute();
  kit.turnsTaken.holding = false;
  assert.deepEqual(
    kit.turnsTaken.held.map(({ issueId }) => issueId),
    ["WEB-1"],
    "the verdict's settlement held in its issue's turn",
  );
  assert.equal(doorbells().at(-1), doorbellOf('WEB-1 "Add retries" (a1) PR #41: CI passed'));
  assert.deepEqual(events(), [], "the doorbell carried the CI result");

  kit.turnsTaken.held.splice(0).forEach(({ release }) => release());
  await settled();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
  assert.deepEqual(events(), ["checked"], "the verdict waits for the doorbell still queued");
  await kit.dispatch(kit.queued(threadId)[0] ?? assert.fail("no doorbell queued"));
  await minute();
  const verdicts = doorbells().filter((doorbell) => doorbell.includes("handed off: done, verified"));
  assert.deepEqual(verdicts, [doorbellOf('WEB-1 "Add retries" (a1) handed off: done, verified')], "announced once");
  assert.deepEqual(events(), []);
});

test("the same verdict with failing CI fails, and the findings sent back to the agent name the failed checks", async () => {
  const { kit, coordinatorId, agentThreadId, row, pr, minute, verified } = await agentOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "FAILURE", failed: ["test (node 22)", "e2e"] });
  await minute();
  const findings = kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent");
  assert.match(findings, /^## Verifier findings: CI failed on #41, though every done-criterion passed\n/);
  assert.match(findings, /### CI failed on #41\n\nFailed checks on this commit: `test \(node 22\)`, `e2e`\./);
  assert.doesNotMatch(findings, /`lint`/, "a check that passed is not named");
  const verdict = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
  assert.deepEqual(verdict?.state === "returned" ? verdict.settlement : null, {
    kind: "sent-back",
    round: 1,
    ci: { kind: "fail", number: 41, failedChecks: ["test (node 22)", "e2e"] },
  });
  assert.equal((await row()).lane, "in-progress", "the agent works on its fix");
});

test("a CI failure after the agent's fix round reaches the coordinating thread as a CI failure, under Needs you", async () => {
  const { kit, threadId, coordinatorId, row, pr, minute, verified } = await agentOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "FAILURE", failed: ["test"] });
  await minute();
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 1, "the first failure went back to the agent");

  // The agent hands off again, and CI on the commit it names has failed.
  await verified();
  assert.deepEqual(await row(), { lane: "needs-you", headline: "✗ CI failed on #41 after its fix round: Retries land with backoff", pr: "#41 open CI fail" });
  // why the catch-up: the coordinating thread is busy with an earlier doorbell by now, so bb holds this one queued.
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /### WEB-1 "Add retries" \(a1\) handed off: done\n[\s\S]*Failed verification: CI failed on #41\. 2 of 2 criteria passed, checked at 0123456789abcdef0123456789abcdef01234567 by a verifier on [^.]*\. bb's git plugin read the agent's environment as it handed off: the claimed commit 0123456789abcdef0123456789abcdef01234567 checked out, on a clean working tree\. CI: failed on #41 at this commit; failed checks, as GitHub names them: test\./);
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId)), /#### Verdict\n\nFailed verification: CI failed on #41\. 2 of 2 criteria passed, checked at /);
});

test("a snapshot of another commit does not settle the verdict, even with CI green", async () => {
  const { row, pr, minute, verified } = await agentOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "SUCCESS", head: "f".repeat(40) });
  await minute();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pass" });
});

test("with gh signed out the board shows why PR status is unavailable, no pr event is recorded, and a pass reads CI not checked", async () => {
  const { kit, board, row, events, pr, minute, verified } = await agentOnGitHub();
  kit.github.failure = Object.assign(new Error("Command failed: gh api graphql"), { code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n" });
  pr({ rollup: "SUCCESS" });
  await minute();
  assert.equal((await board()).prUnavailable, "gh isn't signed in on the machine running bb: run gh auth login there");
  assert.equal((await row()).pr, null);
  assert.ok(!events().includes("pr"), "no pr event while gh can't read GitHub");

  await verified();
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: null });
});

test("a failed read keeps the stored snapshot, and the next good read clears the unavailable line", async () => {
  const { kit, coordinatorId, branch, board, row, pr, minute } = await agentOnGitHub();
  pr();
  await minute();
  const stored = kit.store.prOfBranch(coordinatorId, branch)?.snapshot;
  assert.equal(stored?.number, 41);

  kit.github.failure = Object.assign(new Error("Command failed"), { code: 1, stdout: "", stderr: 'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n' });
  await minute();
  assert.deepEqual(kit.store.prOfBranch(coordinatorId, branch)?.snapshot, stored);
  assert.equal((await board()).prUnavailable, "couldn't reach GitHub");
  assert.equal((await row()).pr, "#41 open CI pending", "the row keeps what was read last");

  kit.github.failure = null;
  await minute();
  assert.equal((await board()).prUnavailable, null);
});

test("an answer gh gives that isn't the pull requests asked for overwrites nothing", async () => {
  const { kit, coordinatorId, branch, board, pr, minute } = await agentOnGitHub();
  pr();
  await minute();
  const stored = kit.store.prOfBranch(coordinatorId, branch)?.snapshot;
  pr({ state: "MERGED", head: "not-a-commit" });
  await minute();
  assert.deepEqual(kit.store.prOfBranch(coordinatorId, branch)?.snapshot, stored);
  assert.equal((await board()).prUnavailable, "GitHub's answer wasn't the pull requests the plugin asked for");
});

test("a merged pull request moves the row to Done, and the coordinating thread hears it merged", async () => {
  const { kit, threadId, row, pr, minute, verified } = await agentOnGitHub();
  pr({ rollup: "SUCCESS" });
  await minute();
  await verified();
  assert.equal((await row()).lane, "in-review");
  pr({ state: "MERGED", rollup: "SUCCESS" });
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged #41", pr: "#41 merged CI pass" });
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### WEB-1 "Add retries" \(a1\) PR #41: merged\n\nAt [^\n]* It is merged \(https:\/\/github\.com\/acme\/webhooks\/pull\/41\)/);
});

test("a repository is read every tick while CI runs or a verdict waits for it, else every five minutes, and never once its issues close", async () => {
  const { kit, threadId, pr, minute, verified } = await agentOnGitHub();
  const runs = () => kit.github.runs.length;
  pr({ rollup: "SUCCESS" });
  await minute();
  assert.equal(runs(), 1, "an agent never read is read at once");
  for (let i = 0; i < 4; i++) await minute();
  assert.equal(runs(), 1, "quiet: not again within five minutes");
  await minute();
  assert.equal(runs(), 2, "quiet: again after five");

  pr({ rollup: "PENDING" });
  for (let i = 0; i < 5; i++) await minute();
  assert.equal(runs(), 3, "the read that sees CI start");
  await minute();
  assert.equal(runs(), 4, "CI running: every tick");
  await verified();
  pr({ rollup: "PENDING", head: "e".repeat(40) });
  await minute();
  await minute();
  assert.equal(runs(), 6, "a verdict waiting for CI: every tick");

  await kit.call("agent_stop", { agent: "a1" }, threadId);
  assert.equal(withoutLinks(textOf(await kit.call("issue_update", { id: "WEB-1", status: "canceled" }, threadId))), "Updated WEB-1.");
  for (let i = 0; i < 10; i++) await minute();
  assert.equal(runs(), 6, "a closed issue is never read");
});

test("an agent whose project isn't on GitHub is not read; a verdict that waits on its pull request passes with CI not checked", async () => {
  const { kit, row, minute, verified } = await agentOnGitHub();
  kit.github.remote = "https://gitlab.com/acme/webhooks.git";
  await minute();
  await verified();
  assert.equal((await row()).lane, "verifying");
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: null });
  assert.equal(kit.github.runs.length, 0);
});

test("a newer done handoff replaces a verdict still waiting for CI, so only the newer one is ever announced", async () => {
  const { kit, coordinatorId, agentThreadId, pr, minute, verified } = await agentOnGitHub();
  pr();
  await minute();
  await verified();
  const waiting = kit.store.latestHandoff(coordinatorId, a1) ?? assert.fail("no handoff");
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", { ...DONE, prUrl: PR_URL }, agentThreadId);
  assert.deepEqual(kit.store.handoff(waiting.handoff.id)?.check?.verdict, { ...waiting.check?.verdict, settlement: { kind: "superseded" } }, "its returned verdict kept whole");
  assert.deepEqual(kit.store.waitingForCi(coordinatorId, a1), []);
});

test("a verdict on a commit with no CI checks yet waits for them, and follows them once GitHub attaches them", async () => {
  const { row, pr, minute, verified } = await agentOnGitHub();
  pr({ rollup: null });
  await minute();
  await verified();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI none" }, "zero checks right after the push is not a pass");
  await minute();
  pr({ rollup: "PENDING" });
  await minute();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pending" });
  pr({ rollup: "SUCCESS" });
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("a verdict on a commit still with no CI checks five minutes after it was first seen passes as no CI checks, never as CI passing", async () => {
  const { kit, threadId, row, doorbells, pr, minute, verified } = await agentOnGitHub();
  pr({ rollup: null });
  await minute();
  await verified();
  for (let i = 0; i < 4; i++) await minute();
  assert.equal((await row()).lane, "verifying", "four minutes after the commit was first seen: still waiting");
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, no CI checks: Retries land with backoff", pr: "#41 open CI none" });
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /- WEB-1 "Add retries" \(a1\) handed off: done, verified, no CI checks$/);
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /CI: no checks; GitHub reported none on #41 at this commit, after the wait for them\./);
  assert.doesNotMatch(catchUp, /CI: passed/);
});

test("zero checks, then the read past the window fails: the verdict keeps waiting, and the next read that still sees none passes it as no CI checks", async () => {
  const { kit, board, row, pr, minute, verified } = await agentOnGitHub();
  pr({ rollup: null });
  await minute();
  await verified();
  for (let i = 0; i < 4; i++) await minute();
  assert.equal((await row()).lane, "verifying", "four minutes of reads seeing no checks: still waiting");
  kit.github.failure = ghSaid('Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host');
  await minute();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI none" }, "a failed read past the window says nothing about CI");
  assert.equal((await board()).prUnavailable, "couldn't reach GitHub");
  kit.github.failure = null;
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, no CI checks: Retries land with backoff", pr: "#41 open CI none" });
});

test("a verdict waiting for CI keeps waiting through every transient gh failure, shows why on the board, and settles ✓ once a read finds CI passed", async () => {
  const { kit, board, row, pr, minute, verified } = await agentOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "SUCCESS" });
  const waiting = { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pending" };
  const transient: [string, () => void][] = [
    ["a timeout", () => (kit.github.failure = recorded("timed-out"))],
    ["an EOF", () => (kit.github.failure = recorded("network-eof"))],
    ["a reset connection", () => (kit.github.failure = ghSaid('Post "https://api.github.com/graphql": read tcp 10.0.0.2:51234->140.82.112.6:443: read: connection reset by peer'))],
    ["a rate limit", () => (kit.github.failure = ghSaid("gh: API rate limit exceeded for user ID 1. (HTTP 403)"))],
    ["an error gh doesn't explain", () => (kit.github.failure = ghSaid("gh: Something went wrong while executing your query. (HTTP 502)"))],
  ];
  const reasons = [];
  for (const [name, fail] of transient) {
    fail();
    await minute();
    assert.deepEqual(await row(), waiting, name);
    reasons.push((await board()).prUnavailable);
  }
  assert.deepEqual(reasons, ["couldn't reach GitHub", "couldn't reach GitHub", "couldn't reach GitHub", "GitHub is limiting requests right now", "Something went wrong while executing your query. (HTTP 502)"]);

  kit.github.failure = null;
  pr({ rollup: "SUCCESS", head: "not-a-commit" });
  await minute();
  assert.deepEqual(await row(), waiting, "an answer that isn't the pull requests asked for");
  assert.equal((await board()).prUnavailable, "GitHub's answer wasn't the pull requests the plugin asked for");

  pr({ rollup: "SUCCESS" });
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
  assert.equal((await board()).prUnavailable, null);
});

test("after a transient gh failure, a read that finds CI failed fails the verdict and sends its findings back for the fix round", async () => {
  const { kit, coordinatorId, agentThreadId, row, pr, minute, verified } = await agentOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "FAILURE", failed: ["test (node 22)"] });
  kit.github.failure = recorded("network-eof");
  await minute();
  assert.equal((await row()).lane, "verifying", "the failed read leaves it waiting");

  kit.github.failure = null;
  await minute();
  assert.match(kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent"), /### CI failed on #41\n\nFailed checks on this commit: `test \(node 22\)`\./);
  const verdict = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
  assert.deepEqual(verdict?.state === "returned" ? verdict.settlement : null, {
    kind: "sent-back",
    round: 1,
    ci: { kind: "fail", number: 41, failedChecks: ["test (node 22)"] },
  });
  assert.equal((await row()).lane, "in-progress");
});

test("a verdict waiting through a transient gh failure settles as CI not checked once gh is missing or GitHub rejects its credentials", async () => {
  for (const [name, reason] of [
    ["not-installed", "gh, the GitHub CLI, isn't installed on the machine running bb"],
    ["bad-credentials-401", "GitHub rejected gh's credentials on the machine running bb (HTTP 401): check gh auth status there"],
  ]) {
    const { kit, coordinatorId, board, row, pr, minute, verified } = await agentOnGitHub();
    pr();
    await minute();
    await verified();
    kit.github.failure = recorded("timed-out");
    await minute();
    assert.equal((await row()).lane, "verifying", `${name}: a timeout first leaves it waiting`);

    kit.github.failure = recorded(name);
    await minute();
    assert.equal((await board()).prUnavailable, reason, name);
    assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: "#41 open CI pending" }, name);
    const verdict = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
    assert.deepEqual(verdict?.state === "returned" ? verdict.settlement : null, {
      kind: "checked",
      refused: null,
      ci: { kind: "not-checked", reason: `PR status unavailable: ${reason}` },
    });
  }
});

test("zero checks, then time passes with no read: the verdict waits for a read past the window, and follows the checks it finds", async () => {
  const { kit, row, pr, minute, verified } = await agentOnGitHub();
  pr({ rollup: null });
  await minute();
  kit.clock.now += 10 * MINUTE; // bb was asleep: no tick, so no read
  pr({ rollup: "SUCCESS" });
  await verified();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI none" }, "the last read was right after the push");
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("an agent whose pull request merged is not read again until it hands off again", async () => {
  const { kit, pr, minute, verified } = await agentOnGitHub();
  const runs = () => kit.github.runs.length;
  pr({ rollup: "SUCCESS" });
  await minute();
  pr({ state: "MERGED", rollup: "SUCCESS" });
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.equal(runs(), 2, "the read that sees it merged");
  for (let i = 0; i < 15; i++) await minute();
  assert.equal(runs(), 2, "merged: never read again on its own");

  await verified();
  await minute();
  assert.equal(runs(), 3, "a handoff after the merge makes it worth reading again");
  for (let i = 0; i < 15; i++) await minute();
  assert.equal(runs(), 3, "still merged: not read again");
});

test("an agent whose pull request closed is read again once it reopens and the agent hands off", async () => {
  const { kit, row, pr, minute, verified } = await agentOnGitHub();
  pr({ state: "CLOSED" });
  await minute();
  for (let i = 0; i < 10; i++) await minute();
  assert.equal(kit.github.runs.length, 1, "closed: read once");
  pr({ state: "OPEN", rollup: "SUCCESS" });
  await verified();
  await minute();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("an agent whose pull request closed, then hands off while a read finds none on its branch, is still read and still waits for CI", async () => {
  const { kit, row, pr, minute, verified } = await agentOnGitHub();
  pr({ state: "CLOSED" });
  await minute();
  kit.github.prs.clear();
  await verified();
  await minute();
  const waiting = { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 closed CI pending" };
  assert.deepEqual(await row(), waiting, "a read that found no pull request says nothing about #41 since the handoff");
  const runs = kit.github.runs.length;
  await minute();
  assert.equal(kit.github.runs.length, runs + 1, "still read every tick");
  assert.deepEqual(await row(), waiting);
});

test("a read that finds the pull request closed, saved after the agent reopened it and handed off, leaves the new verdict waiting and the agent read again", async () => {
  const { kit, row, pr, minute, verified } = await agentOnGitHub();
  pr({ state: "CLOSED" });
  let answer = () => {};
  kit.github.pending = new Promise((resolve) => (answer = resolve));
  kit.clock.now += MINUTE;
  const ticking = kit.tick();
  await settled();
  assert.equal(kit.github.runs.length, 1, "the read is in flight, GitHub's answer: closed");

  pr({ state: "OPEN", rollup: "SUCCESS" });
  await verified();
  kit.github.pending = null;
  answer();
  await ticking;
  await settled();
  assert.deepEqual(await row(), { lane: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 closed CI pending" }, "a read begun before the handoff says nothing about the pull request since");

  await minute();
  assert.equal(kit.github.runs.length, 2, "still read");
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("a verdict whose settle fails leaves every read of the batch saved, and settles on a later tick", async () => {
  const { kit, threadId, coordinatorId, branch, row, pr, minute, verified } = await agentOnGitHub();
  const second = (await startedAgent(kit, threadId, { title: "Add metrics", brief: "Count deliveries.", doneCriteria: ["npm test passes"] })).agentThreadId;
  const secondBranch = kit.thread(second).environmentBranchName ?? assert.fail("no branch");
  const secondPr = (rollup: FakePr["rollup"]) => kit.github.prs.set(secondBranch, { number: 42, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup, failed: [] });
  pr();
  secondPr("PENDING");
  await minute();
  await verified();

  pr({ rollup: "SUCCESS" });
  secondPr("SUCCESS");
  kit.turnEvents.failure = new Error("bb is restarting");
  kit.clock.now += MINUTE;
  await kit.tick();
  assert.match(kit.warnings().join("\n"), /Could not reconcile the verifiers of WEB-1; the next tick tries again: bb is restarting/, "settling WEB-1's verdict, after the reads, fails");
  assert.equal(kit.github.runs.length, 2, "one read of both branches this tick");
  assert.equal(kit.store.prOfBranch(coordinatorId, branch)?.snapshot?.ci, "pass");
  assert.equal(kit.store.prOfBranch(coordinatorId, secondBranch)?.snapshot?.ci, "pass", "the read after the failing verdict's agent is saved too");

  kit.turnEvents.failure = null;
  await minute();
  assert.equal((await row()).lane, "in-review");
});

test("a sandbox agent's environment is read by bb's git plugin only as it hands off: never by the board, the badge, issue_read or the watch", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, board, pr, minute } = await agentOnGitHub({ kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } });
  const { environmentBranchName } = kit.thread(agentThreadId);
  const environmentId = kit.environment(agentThreadId);
  const agentReads = () => kit.git.calls.filter((keys) => keys.includes(environmentId)).length;
  kit.git.checkouts.set(environmentId, "add-retries");
  pr();
  for (let tick = 0; tick < 3; tick++) {
    await board();
    await kit.rpc.needsYou({ keys: [coordinatorId] });
    await kit.call("issue_read", { id: "WEB-1" }, threadId);
    kit.clock.now += 5 * MINUTE;
    await minute();
  }
  assert.equal(agentReads(), 0, "nothing reads the sandbox to learn its branch");
  assert.equal(kit.github.runs.length, 3, "the watch still read GitHub every five minutes");
  assert.ok(kit.github.runs.at(-1)?.includes(`b0=${environmentBranchName}`), "by bb's record of the branch it made");
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId)), new RegExp(`branch \`${environmentBranchName}\``));

  await kit.call("agent_handoff", BLOCKED, agentThreadId);
  assert.equal(agentReads(), 1, "one read, as it hands off");
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId)), /branch `add-retries`/, "issue_read names the branch it handed off on");
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.ok(kit.github.runs.at(-1)?.includes("b0=add-retries"), "the watch reads its pull request by that branch");
  assert.equal(agentReads(), 1, "and still no other read");
});

test("an agent's branch as recorded at a handoff is kept when a later handoff can't read its checkout", async () => {
  const { kit, agentThreadId, row, pr, minute } = await agentOnGitHub();
  const environmentId = kit.environment(agentThreadId);
  kit.git.checkouts.set(environmentId, "add-retries");
  await kit.call("agent_handoff", BLOCKED, agentThreadId);
  pr({}, "add-retries");
  await minute();
  assert.equal((await row()).pr, "#41 open CI pending");

  kit.git.offline.add(environmentId);
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", BLOCKED, agentThreadId);
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.ok(kit.github.runs.at(-1)?.includes("b0=add-retries"), "read by the branch recorded before");
  assert.equal((await row()).pr, "#41 open CI pending");
});

test("a pull request merged while its check is pending makes the issue Done, and the failed verdict that comes after is never sent back", async () => {
  const { kit, coordinatorId, agentThreadId, row, pr, minute } = await agentOnGitHub();
  pr();
  await minute();
  await kit.call("agent_handoff", { ...DONE, prUrl: PR_URL }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  await settled();
  const running = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
  if (running?.state !== "running") return assert.fail("no running verifier");
  assert.equal((await row()).lane, "verifying");

  pr({ state: "MERGED" });
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged #41", pr: "#41 merged CI pending" });

  await kit.call("issue_verdict", { ...PASSES, criteria: [{ criterion: 1, result: "fail", evidence: "# fail 1" }, PASSES.criteria[1]] }, running.verifierThreadId);
  await settled();
  await minute();
  assert.deepEqual(kit.delivered(agentThreadId).filter((text) => text.startsWith("## Verifier findings")), [], "nothing goes back to the agent");
  assert.equal(kit.store.agent(coordinatorId, a1)?.fixRounds, 0);
  assert.equal((await row()).lane, "done");
});

test("an issue In review whose agent's thread was archived still becomes Done when its pull request merges", async () => {
  const { kit, agentThreadId, row, pr, minute, verified } = await agentOnGitHub();
  pr({ rollup: "SUCCESS" });
  await minute();
  await verified();
  assert.equal((await row()).lane, "in-review");

  kit.thread(agentThreadId).archivedAt = Date.now();
  await kit.emit("thread.archived", { thread: kit.ref(agentThreadId) });
  await settled();
  assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" }, "its work survives its thread");

  pr({ state: "MERGED", rollup: "SUCCESS" });
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged #41", pr: "#41 merged CI pass" });
});

test("an issue accepted In review after a failure on review findings alone stays watched, and its merge, read by the watch, makes it Done", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, row, pr, minute } = await agentOnGitHub();
  pr({ rollup: "SUCCESS" });
  await minute();
  await failsVerification(kit, coordinatorId, agentThreadId, "review");
  const accepted = await kit.call("issue_update", { id: "WEB-1", status: "in-review", decision: "Every criterion passes; the cap is polish." }, threadId);
  assert.ok(!isRefusal(accepted), textOf(accepted));
  assert.deepEqual(await row(), { lane: "in-review", headline: "Accepted with follow-ups: Retries land with backoff", pr: "#41 open CI pass" });

  pr({ state: "MERGED", rollup: "SUCCESS" });
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged #41", pr: "#41 merged CI pass" });
});

test("an issue Done by its merge stays Done when its agent is stopped, its manager hears nothing returned, and no new agent starts on it", async () => {
  const { kit, threadId, coordinatorId, row, doorbells, pr, minute } = await agentOnGitHub();
  pr({ state: "MERGED" });
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged #41", pr: "#41 merged CI pending" });

  await kit.call("agent_stop", { agent: "a1" }, threadId);
  await settled();
  assert.equal((await row()).lane, "done");
  assert.ok(!doorbells().some((text) => text.includes("returned to Todo")), "nothing returned to Todo");
  assert.ok(!kit.store.unannounced(coordinatorId).some(({ event }) => event.kind === "returned-to-todo"));

  const restarted = await kit.call("agent_start", { issue: "WEB-1" }, threadId);
  assert.ok(isRefusal(restarted));
  assert.equal(textOf(restarted), "agent_start is refused: WEB-1 is Done (Merged #41), so no agent can start on it.");
  assert.equal(kit.store.agents(coordinatorId).length, 1);
  assert.equal((await row()).lane, "done");
});

for (const event of [true, false]) {
  test(`a verdict waiting for CI settles In review once CI passes, though its agent's thread was deleted meanwhile (${event ? "bb's event heard" : "no event"})`, async () => {
    const { kit, agentThreadId, row, pr, minute, verified } = await agentOnGitHub();
    pr();
    await minute();
    await verified();
    assert.equal((await row()).headline, "Waiting for CI on #41: Retries land with backoff");

    kit.thread(agentThreadId).deletedAt = Date.now();
    if (event) await kit.emit("thread.deleted", { thread: kit.ref(agentThreadId) });
    await settled();
    pr({ rollup: "SUCCESS" });
    await minute();
    assert.deepEqual(await row(), { lane: "in-review", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
    assert.deepEqual(kit.warnings(), []);
  });
}

test("after a newer agent's spawn fails, the issue's pull request is still read on the branch of the agent before it, and its merge makes it Done", async () => {
  const { kit, threadId, agentThreadId, row, pr, minute } = await agentOnGitHub();
  await kit.call("agent_handoff", { ...BLOCKED, prUrl: PR_URL }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  pr();
  kit.clock.now += 5 * MINUTE;
  await minute();
  await kit.call("agent_stop", { agent: "a1" }, threadId);
  Object.assign(kit.spawns, { created: false, answer: "lost" });
  assert.match(textOf(await kit.call("agent_start", { issue: "WEB-1" }, threadId)), /^bb did not start a2/);
  assert.deepEqual(await row(), { lane: "todo", headline: "bb never started its agent's thread", pr: "#41 open CI pending" });

  pr({ state: "MERGED" });
  kit.clock.now += 6 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { lane: "done", headline: "Merged #41", pr: "#41 merged CI pending" });
});

test("a research issue's branch is never read from GitHub, so even a merged pull request on it neither closes it, wakes anyone nor shows on its board row", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const agentThreadId = (await startedAgent(kit, threadId, { kind: "research", doneCriteria: [] })).agentThreadId;
  kit.thread(threadId).status = "idle";
  const branch = kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch");
  kit.github.prs.set(branch, { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  for (let minutes = 0; minutes < 10; minutes++) {
    kit.clock.now += MINUTE;
    await kit.tick();
  }
  await settled();
  assert.deepEqual(kit.github.runs, []);
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId)), /\n\nResearch\. In progress: Working\./);
  const row = (await kit.rpc.board({ coordinatorId })).issues[0] ?? assert.fail("no row");
  assert.deepEqual([row.kind, row.pr], ["research", null]);
});

test("a move's fresh read of a pull request waits for a tick's read still out, so the tick's older head never lands over the newer one", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, branch, pr } = await agentOnGitHub({ kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } });
  const [first, second] = ["1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222"];
  kit.commit(agentThreadId, first);
  kit.push(agentThreadId);
  pr({ head: first });
  let answer = (): void => assert.fail("gh never ran");
  kit.github.pending = new Promise((resolve) => (answer = resolve));
  const ticking = kit.tick(); // its gh answer, as GitHub had it, holds the first head
  await settled();
  kit.github.pending = null;
  kit.commit(agentThreadId, second);
  kit.push(agentThreadId);
  pr({ head: second });

  const moving = kit.call("agent_start", { issue: "WEB-1", placement: { kind: "worktree" } }, threadId);
  await settled();
  answer();
  await ticking;
  const result = textOf(await moving);
  assert.match(result, /on a new branch cut from a1's `origin\/bb\/thr_2` expecting 2222222/);
  assert.equal(kit.store.prOfBranch(coordinatorId, branch)?.snapshot?.headSha, second, "the newer read is the one saved");
});

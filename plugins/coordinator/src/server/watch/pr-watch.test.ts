import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { crewIdSchema } from "../../model/role.ts";
import { coordinating, settled, textOf, threadIn, type FakePr } from "../test-harness.ts";

const c1 = crewIdSchema.parse("c1");
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

/** A coordinating thread with one crew on a GitHub project, both idle; the crew's branch and what the plugin shows of it. */
async function crewOnGitHub(placement: object = { kind: "worktree" }) {
  const { kit, threadId, coordinatorId } = await coordinating();
  const crewThreadId = threadIn(textOf(await kit.call("crew_start", { title: "Add retries", brief: "Retry failed deliveries.", doneCriteria: ["npm test passes", "npm run lint is clean"], placement }, threadId)));
  kit.thread(threadId).status = "idle";
  const branch = kit.thread(crewThreadId).environmentBranchName ?? assert.fail("no branch");
  const board = () => kit.rpc.board({ coordinatorId });
  const row = async () => {
    const { state, headline, pr } = (await board()).rows[0] ?? assert.fail("no row");
    return { state, headline, pr: pr === null ? null : `#${pr.number} ${pr.state} CI ${pr.ci}` };
  };
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  const events = () => kit.store.unannounced(coordinatorId).map(({ event }) => event.kind);
  /** GitHub now has the crew's pull request #41 as given, on its branch as bb records it unless `onBranch` names another. */
  const pr = (fields: Partial<FakePr> = {}, onBranch = branch) => kit.github.prs.set(onBranch, { number: 41, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: "PENDING", failed: [], ...fields });
  /** A minute passes and the schedule runs. */
  async function minute(): Promise<void> {
    kit.clock.now += MINUTE;
    await kit.tick();
    await settled();
  }
  /** The crew hands off as done, naming its pull request, and its verifier passes every criterion. */
  async function verified(): Promise<void> {
    await kit.call("crew_handoff", { ...DONE, prUrl: PR_URL }, crewThreadId);
    await kit.idle(crewThreadId, "Handed off.");
    const handoff = kit.store.latestHandoff(coordinatorId, c1);
    if (handoff?.status !== "done" || handoff.verdict.state !== "running") return assert.fail("no running verifier");
    await kit.call("crew_verdict", PASSES, handoff.verdict.verifierThreadId);
    await settled();
  }
  return { kit, threadId, coordinatorId, crewThreadId, board, row, doorbells, events, pr, minute, verified };
}

test("a crew that opens a pull request shows #n on its row within a tick, and the coordinating thread gets a pr event", async () => {
  const { kit, threadId, row, doorbells, pr, minute } = await crewOnGitHub();
  await minute();
  assert.equal((await row()).pr, null, "no pull request yet");

  pr();
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.equal((await row()).pr, "#41 open CI pending");
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /- c1 "Add retries" PR #41: opened$/);
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /### c1 "Add retries" PR #41: opened\n\nAt [^\n]* It is open \(https:\/\/github\.com\/acme\/webhooks\/pull\/41\), with no approval or change request; CI on its head 0123456: still running\./);
});

test("a verdict that passes while CI is pending waits under Verifying as waiting for CI, then goes to Landing the tick CI passes", async () => {
  const { kit, row, doorbells, pr, minute, verified } = await crewOnGitHub();
  pr();
  await minute();
  await verified();
  assert.deepEqual(await row(), { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pending" });
  const before = doorbells().length;
  await minute();
  assert.equal(doorbells().length, before, "a verdict waiting for CI wakes nobody");

  pr({ rollup: "SUCCESS" });
  await minute();
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
  assert.equal(doorbells().at(-1), '[Coordinator] 2 updates. Call crew_catch_up to read them in full.\n- c1 "Add retries" PR #41: CI passed\n- c1 "Add retries" handed off: done, verified');
});

test("the same verdict with failing CI fails, and the findings sent back to the crew name the failed checks", async () => {
  const { kit, coordinatorId, crewThreadId, row, pr, minute, verified } = await crewOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "FAILURE", failed: ["test (node 22)", "e2e"] });
  await minute();
  const findings = kit.delivered(crewThreadId).at(-1) ?? assert.fail("nothing reached the crew");
  assert.match(findings, /^## Verifier findings: every done-criterion passed, and CI failed on #41\n/);
  assert.match(findings, /### CI failed on #41\n\nFailed checks on this commit: `test \(node 22\)`, `e2e`\./);
  assert.doesNotMatch(findings, /`lint`/, "a check that passed is not named");
  const handoff = kit.store.latestHandoff(coordinatorId, c1);
  assert.deepEqual(handoff?.status === "done" && handoff.verdict.state === "returned" ? handoff.verdict.settlement : null, {
    kind: "sent-back",
    round: 1,
    ci: { kind: "fail", number: 41, failedChecks: ["test (node 22)", "e2e"] },
  });
  assert.equal((await row()).state, "working", "the crew works on its fix");
});

test("a CI failure after the crew's fix round reaches the coordinating thread as a CI failure, under Needs you", async () => {
  const { kit, threadId, coordinatorId, row, pr, minute, verified } = await crewOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "FAILURE", failed: ["test"] });
  await minute();
  assert.equal(kit.store.crew(coordinatorId, c1)?.fixRounds, 1, "the first failure went back to the crew");

  // The crew hands off again, and CI on the commit it names has failed.
  await verified();
  assert.deepEqual(await row(), { state: "needs-you", headline: "✗ CI failed on #41 after its fix round: Retries land with backoff", pr: "#41 open CI fail" });
  // why the catch-up: the coordinating thread is busy with an earlier doorbell by now, so bb holds this one queued.
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /### c1 "Add retries" handed off: done\n[\s\S]*Failed verification: 2 of 2 criteria passed, checked at 0123456789abcdef0123456789abcdef01234567 by a verifier on [^.]*\. CI: failed on #41 at this commit; failed checks, as GitHub names them: test\./);
});

test("a snapshot of another commit does not settle the verdict, even with CI green", async () => {
  const { row, pr, minute, verified } = await crewOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "SUCCESS", head: "f".repeat(40) });
  await minute();
  assert.deepEqual(await row(), { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pass" });
});

test("with gh signed out the board shows why PR status is unavailable, no pr event is recorded, and a pass reads CI not checked", async () => {
  const { kit, board, row, events, pr, minute, verified } = await crewOnGitHub();
  kit.github.failure = Object.assign(new Error("Command failed: gh api graphql"), { code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n" });
  pr({ rollup: "SUCCESS" });
  await minute();
  assert.equal((await board()).prUnavailable, "gh isn't signed in on the machine running bb: run gh auth login there");
  assert.equal((await row()).pr, null);
  assert.ok(!events().includes("pr"), "no pr event while gh can't read GitHub");

  await verified();
  await minute();
  assert.deepEqual(await row(), { state: "ready-for-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: null });
});

test("a failed read keeps the stored snapshot, and the next good read clears the unavailable line", async () => {
  const { kit, coordinatorId, board, row, pr, minute } = await crewOnGitHub();
  pr();
  await minute();
  const stored = kit.store.prStatus(coordinatorId, c1)?.snapshot;
  assert.equal(stored?.number, 41);

  kit.github.failure = Object.assign(new Error("Command failed"), { code: 1, stdout: "", stderr: 'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n' });
  await minute();
  assert.deepEqual(kit.store.prStatus(coordinatorId, c1)?.snapshot, stored);
  assert.equal((await board()).prUnavailable, "couldn't reach GitHub");
  assert.equal((await row()).pr, "#41 open CI pending", "the row keeps what was read last");

  kit.github.failure = null;
  await minute();
  assert.equal((await board()).prUnavailable, null);
});

test("an answer gh gives that isn't the pull requests asked for overwrites nothing", async () => {
  const { kit, coordinatorId, board, pr, minute } = await crewOnGitHub();
  pr();
  await minute();
  const stored = kit.store.prStatus(coordinatorId, c1)?.snapshot;
  pr({ state: "MERGED", head: "not-a-commit" });
  await minute();
  assert.deepEqual(kit.store.prStatus(coordinatorId, c1)?.snapshot, stored);
  assert.equal((await board()).prUnavailable, "GitHub's answer wasn't the pull requests the plugin asked for");
});

test("a merged pull request moves the row to Done, and the coordinating thread hears it merged", async () => {
  const { kit, threadId, row, pr, minute, verified } = await crewOnGitHub();
  pr({ rollup: "SUCCESS" });
  await minute();
  await verified();
  assert.equal((await row()).state, "landing");
  pr({ state: "MERGED", rollup: "SUCCESS" });
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.deepEqual(await row(), { state: "done", headline: "Merged #41", pr: "#41 merged CI pass" });
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### c1 "Add retries" PR #41: merged\n\nAt [^\n]* It is merged \(https:\/\/github\.com\/acme\/webhooks\/pull\/41\)/);
});

test("a repository is read every tick while CI runs or a verdict waits for it, else every five minutes, and never once its crews close", async () => {
  const { kit, threadId, pr, minute, verified } = await crewOnGitHub();
  const runs = () => kit.github.runs.length;
  pr({ rollup: "SUCCESS" });
  await minute();
  assert.equal(runs(), 1, "a crew never read is read at once");
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

  await kit.call("crew_close", { crewId: "c1", action: "resolve" }, threadId);
  for (let i = 0; i < 10; i++) await minute();
  assert.equal(runs(), 6, "a closed crew is never read");
});

test("a crew whose project isn't on GitHub is not read; a verdict that waits on its pull request passes with CI not checked", async () => {
  const { kit, row, minute, verified } = await crewOnGitHub();
  kit.github.remote = "https://gitlab.com/acme/webhooks.git";
  await minute();
  await verified();
  assert.equal((await row()).state, "verifying");
  await minute();
  assert.deepEqual(await row(), { state: "ready-for-review", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: null });
  assert.equal(kit.github.runs.length, 0);
});

test("a newer done handoff replaces a verdict still waiting for CI, so only the newer one is ever announced", async () => {
  const { kit, coordinatorId, crewThreadId, pr, minute, verified } = await crewOnGitHub();
  pr();
  await minute();
  await verified();
  const waiting = kit.store.latestHandoff(coordinatorId, c1)?.id ?? assert.fail("no handoff");
  kit.startTurn(crewThreadId);
  await kit.call("crew_handoff", { ...DONE, prUrl: PR_URL }, crewThreadId);
  const replaced = kit.store.handoff(waiting);
  assert.deepEqual(replaced?.status === "done" ? replaced.verdict : null, { state: "superseded" });
  assert.deepEqual(kit.store.waitingForCi(coordinatorId, c1), []);
});

test("a verdict on a commit with no CI checks yet waits for them, and follows them once GitHub attaches them", async () => {
  const { row, pr, minute, verified } = await crewOnGitHub();
  pr({ rollup: null });
  await minute();
  await verified();
  assert.deepEqual(await row(), { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI none" }, "zero checks right after the push is not a pass");
  await minute();
  pr({ rollup: "PENDING" });
  await minute();
  assert.deepEqual(await row(), { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pending" });
  pr({ rollup: "SUCCESS" });
  await minute();
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("a verdict on a commit still with no CI checks five minutes after it was first seen passes as no CI checks, never as CI passing", async () => {
  const { kit, threadId, row, doorbells, pr, minute, verified } = await crewOnGitHub();
  pr({ rollup: null });
  await minute();
  await verified();
  for (let i = 0; i < 4; i++) await minute();
  assert.equal((await row()).state, "verifying", "four minutes after the commit was first seen: still waiting");
  await minute();
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified, no CI checks: Retries land with backoff", pr: "#41 open CI none" });
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /- c1 "Add retries" handed off: done, verified, no CI checks$/);
  const catchUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(catchUp, /CI: no checks; GitHub reported none on #41 at this commit, after the wait for them\./);
  assert.doesNotMatch(catchUp, /CI: passed/);
});

test("zero checks, then the read past the window fails: the verdict keeps waiting, and the next read that still sees none passes it as no CI checks", async () => {
  const { kit, board, row, pr, minute, verified } = await crewOnGitHub();
  pr({ rollup: null });
  await minute();
  await verified();
  for (let i = 0; i < 4; i++) await minute();
  assert.equal((await row()).state, "verifying", "four minutes of reads seeing no checks: still waiting");
  kit.github.failure = ghSaid('Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host');
  await minute();
  assert.deepEqual(await row(), { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI none" }, "a failed read past the window says nothing about CI");
  assert.equal((await board()).prUnavailable, "couldn't reach GitHub");
  kit.github.failure = null;
  await minute();
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified, no CI checks: Retries land with backoff", pr: "#41 open CI none" });
});

test("a verdict waiting for CI keeps waiting through every transient gh failure, shows why on the board, and settles ✓ once a read finds CI passed", async () => {
  const { kit, board, row, pr, minute, verified } = await crewOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "SUCCESS" });
  const waiting = { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI pending" };
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
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
  assert.equal((await board()).prUnavailable, null);
});

test("after a transient gh failure, a read that finds CI failed fails the verdict and sends its findings back for the fix round", async () => {
  const { kit, coordinatorId, crewThreadId, row, pr, minute, verified } = await crewOnGitHub();
  pr();
  await minute();
  await verified();
  pr({ rollup: "FAILURE", failed: ["test (node 22)"] });
  kit.github.failure = recorded("network-eof");
  await minute();
  assert.equal((await row()).state, "verifying", "the failed read leaves it waiting");

  kit.github.failure = null;
  await minute();
  assert.match(kit.delivered(crewThreadId).at(-1) ?? assert.fail("nothing reached the crew"), /### CI failed on #41\n\nFailed checks on this commit: `test \(node 22\)`\./);
  const handoff = kit.store.latestHandoff(coordinatorId, c1);
  assert.deepEqual(handoff?.status === "done" && handoff.verdict.state === "returned" ? handoff.verdict.settlement : null, {
    kind: "sent-back",
    round: 1,
    ci: { kind: "fail", number: 41, failedChecks: ["test (node 22)"] },
  });
  assert.equal((await row()).state, "working");
});

test("a verdict waiting through a transient gh failure settles as CI not checked once gh is missing or GitHub rejects its credentials", async () => {
  for (const [name, reason] of [
    ["not-installed", "gh, the GitHub CLI, isn't installed on the machine running bb"],
    ["bad-credentials-401", "GitHub rejected gh's credentials on the machine running bb (HTTP 401): check gh auth status there"],
  ]) {
    const { kit, coordinatorId, board, row, pr, minute, verified } = await crewOnGitHub();
    pr();
    await minute();
    await verified();
    kit.github.failure = recorded("timed-out");
    await minute();
    assert.equal((await row()).state, "verifying", `${name}: a timeout first leaves it waiting`);

    kit.github.failure = recorded(name);
    await minute();
    assert.equal((await board()).prUnavailable, reason, name);
    assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified, CI not checked: Retries land with backoff", pr: "#41 open CI pending" }, name);
    const handoff = kit.store.latestHandoff(coordinatorId, c1);
    assert.deepEqual(handoff?.status === "done" && handoff.verdict.state === "returned" ? handoff.verdict.settlement : null, {
      kind: "checked",
      refused: null,
      ci: { kind: "not-checked", reason: `PR status unavailable: ${reason}` },
    });
  }
});

test("zero checks, then time passes with no read: the verdict waits for a read past the window, and follows the checks it finds", async () => {
  const { kit, row, pr, minute, verified } = await crewOnGitHub();
  pr({ rollup: null });
  await minute();
  kit.clock.now += 10 * MINUTE; // bb was asleep: no tick, so no read
  pr({ rollup: "SUCCESS" });
  await verified();
  assert.deepEqual(await row(), { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 open CI none" }, "the last read was right after the push");
  await minute();
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("a crew whose pull request merged is not read again until it hands off again", async () => {
  const { kit, pr, minute, verified } = await crewOnGitHub();
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

test("a crew whose pull request closed is read again once it reopens and the crew hands off", async () => {
  const { kit, row, pr, minute, verified } = await crewOnGitHub();
  pr({ state: "CLOSED" });
  await minute();
  for (let i = 0; i < 10; i++) await minute();
  assert.equal(kit.github.runs.length, 1, "closed: read once");
  pr({ state: "OPEN", rollup: "SUCCESS" });
  await verified();
  await minute();
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("a crew whose pull request closed, then hands off while a read finds none on its branch, is still read and still waits for CI", async () => {
  const { kit, row, pr, minute, verified } = await crewOnGitHub();
  pr({ state: "CLOSED" });
  await minute();
  kit.github.prs.clear();
  await verified();
  await minute();
  const waiting = { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 closed CI pending" };
  assert.deepEqual(await row(), waiting, "a read that found no pull request says nothing about #41 since the handoff");
  const runs = kit.github.runs.length;
  await minute();
  assert.equal(kit.github.runs.length, runs + 1, "still read every tick");
  assert.deepEqual(await row(), waiting);
});

test("a read that finds the pull request closed, saved after the crew reopened it and handed off, leaves the new verdict waiting and the crew read again", async () => {
  const { kit, row, pr, minute, verified } = await crewOnGitHub();
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
  assert.deepEqual(await row(), { state: "verifying", headline: "Waiting for CI on #41: Retries land with backoff", pr: "#41 closed CI pending" }, "a read begun before the handoff says nothing about the pull request since");

  await minute();
  assert.equal(kit.github.runs.length, 2, "still read");
  assert.deepEqual(await row(), { state: "landing", headline: "✓ Verified: Retries land with backoff", pr: "#41 open CI pass" });
});

test("a verdict whose settle fails leaves every read of the batch saved, and settles on a later tick", async () => {
  const { kit, threadId, coordinatorId, row, pr, minute, verified } = await crewOnGitHub();
  const second = threadIn(textOf(await kit.call("crew_start", { title: "Add metrics", brief: "Count deliveries.", doneCriteria: ["npm test passes"] }, threadId)));
  const secondBranch = kit.thread(second).environmentBranchName ?? assert.fail("no branch");
  const c2 = crewIdSchema.parse("c2");
  const secondPr = (rollup: FakePr["rollup"]) => kit.github.prs.set(secondBranch, { number: 42, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup, failed: [] });
  pr();
  secondPr("PENDING");
  await minute();
  await verified();

  pr({ rollup: "SUCCESS" });
  secondPr("SUCCESS");
  kit.turnEvents.failure = new Error("bb is restarting");
  kit.clock.now += MINUTE;
  await assert.rejects(kit.tick(), /bb is restarting/, "settling c1's verdict, after the reads, fails");
  assert.equal(kit.github.runs.length, 2, "one read of both branches this tick");
  assert.equal(kit.store.prStatus(coordinatorId, c1)?.snapshot?.ci, "pass");
  assert.equal(kit.store.prStatus(coordinatorId, c2)?.snapshot?.ci, "pass", "the read after the failing verdict's crew is saved too");

  kit.turnEvents.failure = null;
  await minute();
  assert.equal((await row()).state, "landing");
});

test("a sandbox crew's environment is read by bb's git plugin only as it hands off: never by the board, the badge, crew_read or the watch", async () => {
  const { kit, threadId, coordinatorId, crewThreadId, board, pr, minute } = await crewOnGitHub({ kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } });
  const { environmentId, environmentBranchName } = kit.thread(crewThreadId);
  const crewReads = () => kit.git.calls.filter((keys) => keys.includes(environmentId)).length;
  kit.git.checkouts.set(environmentId, "add-retries");
  pr();
  for (let tick = 0; tick < 3; tick++) {
    await board();
    await kit.rpc.needsYou({ keys: [coordinatorId] });
    await kit.call("crew_read", { crewId: "c1" }, threadId);
    kit.clock.now += 5 * MINUTE;
    await minute();
  }
  assert.equal(crewReads(), 0, "nothing reads the sandbox to learn its branch");
  assert.equal(kit.github.runs.length, 3, "the watch still read GitHub every five minutes");
  assert.ok(kit.github.runs.at(-1)?.includes(`b0=${environmentBranchName}`), "by bb's record of the branch it made");
  assert.equal((await board()).rows[0]?.branch, environmentBranchName);

  await kit.call("crew_handoff", BLOCKED, crewThreadId);
  assert.equal(crewReads(), 1, "one read, as it hands off");
  assert.equal((await board()).rows[0]?.branch, "add-retries", "the board shows the branch it handed off on");
  assert.match(textOf(await kit.call("crew_read", { crewId: "c1" }, threadId)), /add-retries/);
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.ok(kit.github.runs.at(-1)?.includes("b0=add-retries"), "the watch reads its pull request by that branch");
  assert.equal(crewReads(), 1, "and still no other read");
});

test("a crew's branch as recorded at a handoff is kept when a later handoff can't read its checkout", async () => {
  const { kit, crewThreadId, row, pr, minute } = await crewOnGitHub();
  const { environmentId } = kit.thread(crewThreadId);
  kit.git.checkouts.set(environmentId, "add-retries");
  await kit.call("crew_handoff", BLOCKED, crewThreadId);
  pr({}, "add-retries");
  await minute();
  assert.equal((await row()).pr, "#41 open CI pending");

  kit.git.offline.add(environmentId);
  kit.startTurn(crewThreadId);
  await kit.call("crew_handoff", BLOCKED, crewThreadId);
  kit.clock.now += 5 * MINUTE;
  await minute();
  assert.ok(kit.github.runs.at(-1)?.includes("b0=add-retries"), "read by the branch recorded before");
  assert.equal((await row()).pr, "#41 open CI pending");
});

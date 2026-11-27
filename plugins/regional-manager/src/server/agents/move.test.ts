// Issue 06's acceptance criteria, through the harness: a handover that moves the work to a new
// environment on a branch cut from the previous agent's. Criteria 5 to 9 involve a sandbox; here the
// fake bb stands in for it as the probes observed it: a sandbox clones its base from origin (SH2),
// its branch reaches origin only when pushed (SH4), its last thread's archive destroys it (SH5), and
// bb's git plugin can't read it while suspended (SH5). GitHub is the fake gh's pull requests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { laneOf } from "../../model/board/board-groups.ts";
import { coordinating, HEAD, isRefusal, settled, startedAgent, textOf, threadIn } from "../test-harness.ts";
import { takeUnread } from "../store/test-store.ts";

const a1 = agentIdSchema.parse("a1");
const a2 = agentIdSchema.parse("a2");
const COMMITTED = "1111111111111111111111111111111111111111";
const LATER = "2222222222222222222222222222222222222222";
const BLOCKED = { status: "blocked", summary: "Needs the staging key", did: ["Wrote the retry loop"], evidence: [], concerns: [], deviations: [], findings: [], attachments: [], headSha: COMMITTED };
const WORKTREE = { kind: "worktree" };
const SANDBOX = { kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } };
// why: whether an agent opens a pull request is its brief's call, so a handover's own words never tell it to.
const OPEN_A_PULL_REQUEST = /open (a|its|your)( own)? (pull request|merge request|PR|MR)|open one\b|pull request of your own/i;

/** A regional manager whose agent a1 holds build issue WEB-1, started with `start` (a worktree by default), working. */
async function holding(start: object = {}) {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const { agentThreadId } = await startedAgent(kit, threadId, {}, start);
  const call = async (input: object = {}) => kit.call("agent_start", { issue: "WEB-1", ...input }, threadId);
  const agent = (id: typeof a1) => kit.store.agent(coordinatorId, id) ?? assert.fail(`no agent ${id}`);
  const environmentOf = (thread: string) => kit.environment(thread);
  /** The commit checked out in the thread's environment, as `git log -1` shows it. */
  const headOf = (thread: string) => kit.git.heads.get(environmentOf(thread)) ?? HEAD;
  /** The branch checked out in the thread's environment (a1's by default) is pushed at its head, and a pull request opened from it. */
  const pushAndOpen = (thread = agentThreadId) => {
    const branch = kit.push(thread);
    kit.github.prs.set(branch, { number: 44, state: "OPEN", isDraft: false, reviewDecision: null, head: headOf(thread), rollup: "SUCCESS", failed: [] });
    return branch;
  };
  const row = async () => {
    const issue = (await kit.rpc.board({ coordinatorId })).issues[0] ?? assert.fail("no row");
    return [laneOf(issue), issue.headline];
  };
  return { kit, threadId, coordinatorId, agentThreadId, call, agent, environmentOf, headOf, pushAndOpen, row, branch: kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch") };
}

test("criterion 1: worktree to worktree: a1's committed work moves to a fresh worktree, on a branch of its own cut from a1's, whose first message names it", async () => {
  const { kit, agentThreadId, call, agent, headOf, branch } = await holding();
  kit.commit(agentThreadId, COMMITTED);
  const runs = kit.github.runs.length;

  const result = textOf(await call({ placement: WORKTREE }));
  const next = threadIn(result);
  assert.match(result, new RegExp(`^Stopped a1 and started a2 on WEB-1 as @thread:${next} in a new worktree, on a new branch cut from a1's \`${branch}\` expecting 1111111, on claude-code opus \\(high\\), your own provider, model and reasoning level\\. a2 checks that commit is on its branch before it changes anything, and hands off blocked if it isn't\\. Nothing a1 left uncommitted comes with it; if bb can't cut that branch, its thread fails and you are woken\\. Its first message`));
  assert.deepEqual([kit.thread(agentThreadId).status, kit.thread(agentThreadId).archivedAt, agent(a1).ended?.how], ["idle", null, "replaced"], "a1 stopped, never archived");
  assert.deepEqual(kit.thread(next).spawnedWith.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: branch } } });
  assert.equal(headOf(next), COMMITTED, "git log -1 in a2's worktree is a1's tip");
  assert.notEqual(kit.thread(next).environmentBranchName, branch, "on a branch of its own");
  assert.deepEqual(agent(a2).base, { kind: "cut", from: "a1", branch, via: "local", head: COMMITTED });
  assert.equal(kit.github.runs.length, runs, "worktree to worktree needs no push proof");
  const message = kit.thread(next).spawnedWith.prompt ?? "";
  assert.match(message, /Do it on your own branch, which bb cut from an earlier agent's: check it first, as Your branch says\./);
  assert.equal(
    message.split("## Your branch\n\n")[1]?.split("\n\n")[0],
    `You work in a new environment, on a new branch of your own that bb cut from a1's branch \`${branch}\`. a1 no longer works on this issue, and nothing it left uncommitted is on your branch. a1 left its work at commit \`${COMMITTED}\`. Before you change anything, check that commit is in your checkout: run \`git merge-base --is-ancestor ${COMMITTED} HEAD && echo present\`. If it doesn't print \`present\`, change nothing, and call agent_handoff with status blocked, saying commit ${COMMITTED} is missing from your branch. Once it is there, run \`git log\`, and decide from it and the handoffs below where to pick up. Don't push to a1's branch \`${branch}\`. Deliver your work from your own branch, as your brief says.`,
  );
  assert.doesNotMatch(message, OPEN_A_PULL_REQUEST, "whether to open a pull request is the brief's call");
});

test("criterion 1: the same move after a1's thread is archived, and after its worktree is removed, still cuts from its local branch", async () => {
  const archived = await holding();
  archived.kit.commit(archived.agentThreadId, COMMITTED);
  archived.kit.thread(archived.agentThreadId).archivedAt = 5_000;
  await archived.kit.tick();
  const afterArchive = threadIn(textOf(await archived.call({ placement: WORKTREE })));
  assert.equal(archived.headOf(afterArchive), COMMITTED);

  const removed = await holding();
  removed.kit.commit(removed.agentThreadId, COMMITTED);
  removed.kit.thread(removed.agentThreadId).archivedAt = 5_000;
  removed.kit.environments.destroyed.add(removed.environmentOf(removed.agentThreadId)); // bb environment cleanup: the worktree goes, its branch stays
  await removed.kit.tick();
  const result = textOf(await removed.call());
  assert.match(result, /^Started a2 on WEB-1 as @thread:\w+ in a new worktree, on a new branch cut from a1's `bb\/thr_2`/, "no placement named: its environment is gone, so the work moves to a new one like it");
  assert.equal(removed.headOf(threadIn(result)), COMMITTED);
});

test("criterion 1: a move cuts from the branch a1's environment has checked out, at its head, both from one read: a branch a1 switched to and committed on moves, a detached HEAD is refused", async () => {
  const { kit, agentThreadId, call, agent, headOf, pushAndOpen, environmentOf, branch } = await holding();
  const environment = environmentOf(agentThreadId);
  kit.commit(agentThreadId, COMMITTED);
  kit.git.checkouts.set(environment, "bb/retry-jitter"); // git switch -c bb/retry-jitter
  kit.commit(agentThreadId, LATER); // bb's record still names a1's first branch, at COMMITTED

  kit.git.checkouts.delete(environment); // git switch --detach
  const spawned = kit.spawned();
  const detached = await call({ placement: WORKTREE });
  assert.ok(isRefusal(detached));
  assert.equal(
    textOf(detached),
    "agent_start is refused: Nothing changed. a1's environment has no branch checked out (HEAD is detached at 2222222), so a new environment has none to start from. Continue in it (leave out placement), or ask a1 to check out a branch with its commits, then call again.",
  );
  assert.deepEqual([kit.spawned(), kit.thread(agentThreadId).status, agent(a1).ended], [spawned, "active", null], "nothing stopped or started");

  kit.git.checkouts.set(environment, "bb/retry-jitter");
  const local = threadIn(textOf(await call({ placement: WORKTREE })));
  assert.equal(headOf(local), LATER, "a2 starts at the commit a1 made on the branch it switched to");
  assert.deepEqual(agent(a2).base, { kind: "cut", from: "a1", branch: "bb/retry-jitter", via: "local", head: LATER });
  assert.equal(kit.repo.local.get(branch), COMMITTED, "not cut from the branch on record");

  // Through origin, the proof is asked of the branch checked out, at its head.
  kit.git.checkouts.set(environmentOf(local), "bb/retry-backoff");
  kit.commit(local, COMMITTED);
  assert.equal(pushAndOpen(local), "bb/retry-backoff");
  const sandbox = threadIn(textOf(await call({ placement: SANDBOX })));
  assert.deepEqual(kit.thread(sandbox).spawnedWith.environment, {
    type: "provider",
    environmentProviderId: "boat-sandbox",
    inputs: { branch: { kind: "new", baseBranch: "origin/bb/retry-backoff" } },
    machine: { type: "new", machineProviderId: "boat-sandbox", inputs: { preset: "small" } },
  });
  assert.equal(headOf(sandbox), COMMITTED);
});

test("criterion 2: a1 stopped with uncommitted files: the move is refused naming them, offering the continue; once a1 commits, it moves", async () => {
  const { kit, threadId, agentThreadId, call, agent, headOf } = await holding();
  await kit.call("agent_stop", { agent: "a1" }, threadId);
  kit.git.changedFiles.set(kit.environment(agentThreadId), 2);
  const spawned = kit.spawned();

  const refused = await call({ placement: WORKTREE });
  assert.ok(isRefusal(refused));
  assert.equal(
    textOf(refused),
    "agent_start is refused: Nothing changed. a1 left 2 files uncommitted (?? scratch-1.txt, ?? scratch-2.txt) in its environment, which a new environment wouldn't get. Continue in it (leave out placement), or ask a1 to commit them, then call again.",
  );
  assert.deepEqual([kit.spawned(), agent(a1).ended?.how], [spawned, "stopped"], "nothing started, and a1's record is as it was");

  kit.git.changedFiles.delete(kit.environment(agentThreadId));
  kit.commit(agentThreadId, COMMITTED);
  assert.equal(headOf(threadIn(textOf(await call({ placement: WORKTREE })))), COMMITTED);
});

test("criterion 2: a holder that still works is refused before it is stopped; one that leaves files uncommitted while it stops is refused after, still holding", async () => {
  const { kit, agentThreadId, call, agent } = await holding();
  kit.git.changedFiles.set(kit.environment(agentThreadId), 1);
  const early = await call({ placement: WORKTREE });
  assert.match(textOf(early), /^agent_start is refused: Nothing changed\. a1 left 1 file uncommitted/);
  assert.deepEqual([kit.thread(agentThreadId).status, agent(a1).ended], ["active", null], "a1 still works");

  kit.git.changedFiles.delete(kit.environment(agentThreadId));
  let answer = (): void => assert.fail("bb never received the stop");
  kit.stopRequests.pending = new Promise((resolve) => (answer = resolve));
  const moving = call({ placement: WORKTREE });
  await settled();
  kit.git.changedFiles.set(kit.environment(agentThreadId), 1); // its last edit lands as it stops
  answer();
  const late = await moving;
  assert.ok(isRefusal(late));
  assert.match(textOf(late), /^agent_start is refused: Stopped a1, but nothing else changed: a1 left 1 file uncommitted \(\?\? scratch-1\.txt\) in its environment/);
  assert.deepEqual([kit.thread(agentThreadId).status, agent(a1).ended, kit.store.agents(agent(a1).coordinatorId).length], ["idle", null, 1], "a1 still holds WEB-1, and nothing started");
});

test("criterion 3: bb refusing the base errors a2 in provisioning; the issue isn't lost: a call without placement continues in a1's environment, and from default starts clean", async () => {
  const { kit, coordinatorId, agentThreadId, call, agent, branch } = await holding();
  kit.repo.local.delete(branch); // someone deleted a1's local branch

  const failed = threadIn(textOf(await call({ placement: WORKTREE })));
  await settled();
  assert.deepEqual([kit.thread(failed).status, kit.thread(failed).environmentId, kit.thread(failed).environmentBranchName], ["error", null, null], "bb's worktree add failed: invalid reference");
  const woken = takeUnread(kit.store, coordinatorId, Date.now()).filter(({ event }) => event.kind === "failed");
  assert.equal(woken.length, 1, "the manager is woken failed, today's path");
  await kit.tick();
  assert.ok(kit.github.runs.at(-1)?.some((arg) => arg.includes(branch)), "the PR watch still reads a1's branch: the failed cut hides nothing");

  const back = textOf(await call());
  assert.match(back, /^Stopped a2 and started a3 on WEB-1 as @thread:\w+ in a1's worktree, on its branch `bb\/thr_2`/, "previous is a1, the latest with a branch");
  assert.deepEqual(kit.thread(threadIn(back)).spawnedWith.environment, { type: "reuse", environmentId: kit.thread(agentThreadId).environmentId });
  assert.equal(agent(a2).ended?.how, "replaced");

  const fresh = textOf(await call({ from: "default" }));
  assert.match(fresh, /It starts clean, in its own environment from the default branch\./);
});

test("criterion 4: a research issue's move starts clean: no cut, no read of its environment, no push proof", async () => {
  const { kit, threadId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId, { kind: "research", doneCriteria: ["Which queue?"] }, { placement: SANDBOX });
  await kit.idle(agentThreadId, "Still reading.");
  const [reads, runs] = [kit.git.calls.length, kit.github.runs.length];

  const result = textOf(await kit.call("agent_start", { issue: "WEB-1", placement: WORKTREE }, threadId));
  assert.match(result, /It starts clean, in its own environment from the default branch\./);
  assert.deepEqual(kit.thread(threadIn(result)).spawnedWith.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
  assert.deepEqual([kit.git.calls.length, kit.github.runs.length], [reads, runs]);
});

test("a move of a blocked issue says what blocks it, as every start does", async () => {
  const { kit, threadId, agentThreadId, call } = await holding();
  await kit.call("issue_create", { kind: "build", title: "Retry budget", description: "How many retries we can afford." }, threadId);
  await kit.call("issue_update", { id: "WEB-1", dependsOn: { add: ["WEB-2"] } }, threadId);
  kit.commit(agentThreadId, COMMITTED);

  const moved = textOf(await call({ placement: WORKTREE }));
  assert.match(moved, /^Stopped a1 and started a2 on WEB-1 as @thread:\w+ in a new worktree, on a new branch cut from a1's /);
  assert.match(moved, / WEB-1 is blocked by WEB-2 \(Todo\): its agent started anyway, and has nothing of that work but what its brief names\.$/);
});

test("an issue split into sub-issues since its agent stopped is refused as a parent before a move reads anything: not its agent's sandbox, nor its pull request", async () => {
  const { kit, threadId, agentThreadId, call, pushAndOpen } = await holding({ placement: SANDBOX });
  kit.commit(agentThreadId, COMMITTED);
  pushAndOpen();
  assert.match(textOf(await kit.call("agent_stop", { agent: "a1" }, threadId)), /^a1 is stopped; it no longer holds WEB-1\./);
  await kit.call("issue_create", { kind: "build", title: "Dead letters", description: "Keep what can't be delivered.", parent: "WEB-1" }, threadId);
  const [reads, runs] = [kit.git.calls.length, kit.github.runs.length];

  const refused = await call({ placement: WORKTREE });
  assert.deepEqual([isRefusal(refused), textOf(refused)], [true, "agent_start is refused: WEB-1 has sub-issues (WEB-2), and a parent has no agent of its own: start agents on them."]);
  assert.deepEqual([kit.git.calls.length, kit.github.runs.length], [reads, runs], "no git read, no gh read");
});

test("criterion 5 (sandbox, harness): worktree to sandbox cuts from origin at a1's pull request's head, on a new branch; unpushed, it is refused before anything stops", async () => {
  const { kit, coordinatorId, agentThreadId, call, agent, headOf, pushAndOpen, branch } = await holding();
  kit.commit(agentThreadId, COMMITTED);
  const unpushed = await call({ placement: SANDBOX });
  assert.ok(isRefusal(unpushed));
  assert.equal(
    textOf(unpushed),
    `agent_start is refused: Nothing changed. a1's branch \`${branch}\` isn't shown on origin at its head 1111111: a move with a sandbox on either side reaches the branch only through origin, and only a pull request or merge request whose head is that commit shows it was pushed. Continue in its environment (leave out placement), or call again once a pull request or merge request on \`${branch}\` has that commit as its head.`,
  );
  assert.doesNotMatch(textOf(unpushed), OPEN_A_PULL_REQUEST, "whether to open a pull request is the brief's call");
  assert.deepEqual([kit.thread(agentThreadId).status, agent(a1).ended], ["active", null], "nothing stopped");

  pushAndOpen();
  const result = textOf(await call({ placement: SANDBOX, execution: { providerId: "codex", model: "gpt-default" } }));
  const next = threadIn(result);
  assert.match(result, new RegExp(`in a new boat-sandbox environment, on a new branch cut from a1's \`origin/${branch}\` expecting 1111111, on codex gpt-default \\(high\\)\\. a2 checks that commit is on its branch before it changes anything, and hands off blocked if it isn't\\. Nothing a1 left uncommitted comes with it; if bb can't cut that branch, its thread fails and you are woken\\. a1's PR #44 stays on its branch, and a2 doesn't push to it\\.`));
  assert.deepEqual(kit.thread(next).spawnedWith.environment, {
    type: "provider",
    environmentProviderId: "boat-sandbox",
    inputs: { branch: { kind: "new", baseBranch: `origin/${branch}` } },
    machine: { type: "new", machineProviderId: "boat-sandbox", inputs: { preset: "small" } },
  });
  assert.equal(headOf(next), COMMITTED, "the new sandbox's HEAD is a1's PR head");
  assert.notEqual(kit.thread(next).environmentBranchName, branch);
  assert.equal(kit.thread(next).providerId, "codex", "the execution named, checked against bb's primary machine");
  const message = kit.thread(next).spawnedWith.prompt ?? "";
  assert.match(message, new RegExp(`cut from a1's branch \`origin/${branch}\`\\. [^\\n]* a1 left its work at commit \`${COMMITTED}\`\\. [^\\n]* a1's pull request #44 stays on \`${branch}\`: don't push to that branch\\. Deliver your work from your own branch, as your brief says\\.`));
  assert.doesNotMatch(message, OPEN_A_PULL_REQUEST, "whether to open a pull request is the brief's call");
  assert.equal(kit.store.agent(coordinatorId, a2)?.base.kind, "cut");
});

test("criterion 5 (sandbox, harness): a move through origin reads the pull request fresh, once for both its judgments: one forced back to an older head since the tick saved the newer is refused", async () => {
  const { kit, agentThreadId, call, agent, pushAndOpen, branch } = await holding();
  kit.commit(agentThreadId, COMMITTED);
  pushAndOpen();
  await kit.tick(); // the watch saves the pull request at COMMITTED
  kit.repo.origin.set(branch, HEAD); // git push --force origin HEAD~1:<branch>; a1's checkout stays at COMMITTED
  kit.github.prs.set(branch, { number: 44, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  const [runs, spawned] = [kit.github.runs.length, kit.spawned()];

  const refused = await call({ placement: SANDBOX });
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /^agent_start is refused: Nothing changed\. a1's branch `bb\/thr_2` isn't shown on origin at its head 1111111/);
  assert.deepEqual([kit.github.runs.length, kit.spawned(), kit.thread(agentThreadId).status, agent(a1).ended], [runs + 1, spawned, "active", null]);

  pushAndOpen(); // pushed again
  const moved = threadIn(textOf(await call({ placement: SANDBOX })));
  assert.equal(kit.github.runs.length, runs + 2, "one read for the start's two judgments, the head unchanged between them");
  assert.equal(kit.git.heads.get(kit.environment(moved)), COMMITTED);
});

test("criterion 5 (sandbox, harness): a saved pull request at the head is no proof when GitHub can't be read now: refused with the read's reason, nothing stopped", async () => {
  const { kit, agentThreadId, call, agent, pushAndOpen } = await holding();
  kit.commit(agentThreadId, COMMITTED);
  pushAndOpen();
  await kit.tick(); // the watch saves the pull request at COMMITTED, the head a1 still has
  kit.github.failure = Object.assign(new Error("Command failed: gh api graphql"), { code: 1, stdout: "", stderr: "unexpected EOF" });
  const spawned = kit.spawned();

  const refused = await call({ placement: SANDBOX });
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /^agent_start is refused: Nothing changed\. Whether a1's branch `bb\/thr_2` is on origin at its head 1111111 can't be read now: couldn't reach GitHub/);
  assert.deepEqual([kit.spawned(), kit.thread(agentThreadId).status, agent(a1).ended], [spawned, "active", null]);
});

test("criterion 5 (sandbox, harness): a branch that moves after the proof, before bb cuts, still starts the agent, whose first message names the commit to check for and what to do if it is missing", async () => {
  const { kit, agentThreadId, call, pushAndOpen, branch } = await holding();
  kit.commit(agentThreadId, COMMITTED);
  pushAndOpen();
  kit.provisioning.holding = true; // bb answers the spawn, then cuts

  const result = textOf(await call({ placement: SANDBOX }));
  const next = threadIn(result);
  assert.match(result, new RegExp(`cut from a1's \`origin/${branch}\` expecting 1111111, on [^.]*\\. a2 checks that commit is on its branch before it changes anything, and hands off blocked if it isn't\\.`));
  kit.repo.origin.set(branch, HEAD); // git push --force origin HEAD~1:<branch>, after the proof
  kit.provisioning.held.splice(0).forEach((provision) => provision());

  assert.equal(kit.git.heads.get(kit.environment(next)), HEAD, "bb cut the branch as origin had it then, without a1's commit");
  const message = kit.thread(next).spawnedWith.prompt ?? "";
  assert.match(message, new RegExp(`check that commit is in your checkout: run \`git merge-base --is-ancestor ${COMMITTED} HEAD && echo present\`\\. If it doesn't print \`present\`, change nothing, and call agent_handoff with status blocked, saying commit ${COMMITTED} is missing from your branch\\.`));
});

test("criterion 6 (sandbox, harness): a branch pushed from inside a sandbox is saved by the PR watch at the pushed head within its next read", async () => {
  const { kit, coordinatorId, agentThreadId, pushAndOpen } = await holding({ placement: SANDBOX });
  kit.commit(agentThreadId, COMMITTED); // git commit in the sandbox
  const branch = pushAndOpen(); // git push -u origin HEAD; gh pr create --fill
  assert.equal(kit.repo.origin.get(branch), COMMITTED, "git ls-remote --heads origin <branch> prints the sandbox's HEAD");
  await kit.tick();
  assert.equal(kit.store.prOfBranch(coordinatorId, branch)?.snapshot?.headSha, COMMITTED);
});

test("criterion 7 (sandbox, harness): sandbox to worktree cuts from origin at the pushed head; called right after the push, it reads the pull request fresh", async () => {
  const { kit, coordinatorId, agentThreadId, call, headOf, pushAndOpen } = await holding({ placement: SANDBOX });
  kit.commit(agentThreadId, COMMITTED);
  const branch = pushAndOpen();
  await kit.tick();
  kit.commit(agentThreadId, LATER);
  pushAndOpen(); // pushed within the minute: the saved snapshot still shows the earlier head
  const runs = kit.github.runs.length;

  const next = threadIn(textOf(await call({ placement: WORKTREE })));
  assert.equal(kit.github.runs.length, runs + 1, "one fresh gh read");
  assert.equal(kit.store.prOfBranch(coordinatorId, branch)?.snapshot?.headSha, LATER, "and it is saved");
  assert.deepEqual(kit.thread(next).spawnedWith.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: `origin/${branch}` } } });
  assert.equal(headOf(next), LATER);
});

test("criterion 8 (sandbox, harness): once bb destroys a1's sandbox, a start with no placement moves to a new small sandbox at the pushed head; never pushed, it is refused as lost", async () => {
  for (const pushed of [true, false]) {
    const { kit, threadId, agentThreadId, call, headOf, pushAndOpen, environmentOf } = await holding({ placement: SANDBOX });
    kit.commit(agentThreadId, COMMITTED);
    await kit.call("agent_handoff", BLOCKED, agentThreadId); // records the head a1 left
    await kit.idle(agentThreadId, "Blocked.");
    if (pushed) pushAndOpen();
    await kit.call("agent_stop", { agent: "a1", archive: true }, threadId); // its last thread: bb destroys the sandbox
    assert.ok(kit.environments.destroyed.has(environmentOf(agentThreadId)));

    const result = await call();
    if (pushed) {
      const next = threadIn(textOf(result));
      assert.deepEqual(kit.thread(next).spawnedWith.environment, {
        type: "provider",
        environmentProviderId: "boat-sandbox",
        inputs: { branch: { kind: "new", baseBranch: "origin/bb/thr_2" } },
        machine: { type: "new", machineProviderId: "boat-sandbox", inputs: { preset: "small" } },
      });
      assert.equal(headOf(next), COMMITTED);
    } else {
      assert.ok(isRefusal(result));
      assert.equal(
        textOf(result),
        `agent_start is refused: Nothing changed. bb removed a1's boat-sandbox environment, and nothing shows its branch \`bb/thr_2\` reached origin at its head 1111111 (no pull request or merge request has that head): its unpushed commits went with it. Start clean with from: "default", which starts from the default branch with every earlier handoff and verdict in the new agent's first message.`,
      );
    }
  }
});

test("criterion 8 (harness): once bb removes a1's worktree, a move to a sandbox of its unpushed commits is refused saying they are still on its branch, and a start with no placement reaches them", async () => {
  const { kit, threadId, agentThreadId, call, headOf, environmentOf, branch } = await holding();
  kit.commit(agentThreadId, COMMITTED);
  await kit.call("agent_handoff", BLOCKED, agentThreadId); // records the head a1 left
  await kit.idle(agentThreadId, "Blocked.");
  await kit.call("agent_stop", { agent: "a1", archive: true }, threadId);
  kit.environments.destroyed.add(environmentOf(agentThreadId)); // bb environment cleanup: the worktree goes, its branch stays

  const refused = await call({ placement: SANDBOX });
  assert.ok(isRefusal(refused));
  assert.equal(
    textOf(refused),
    `agent_start is refused: Nothing changed. bb removed a1's worktree, and nothing shows its branch \`${branch}\` reached origin at its head 1111111 (no pull request or merge request has that head): its commits are still on that branch on your machine, which a new worktree reaches. Leave out placement, or name a worktree, and the new agent starts on a branch cut from it; a move to a sandbox works once a pull request or merge request on its branch has its head. Or start clean with from: "default", which starts from the default branch with every earlier handoff and verdict in the new agent's first message.`,
  );
  assert.equal(kit.repo.local.get(branch), COMMITTED);

  const recovered = threadIn(textOf(await call()));
  assert.equal(headOf(recovered), COMMITTED, "the start the refusal offers reaches a1's commits");
});

test("criterion 9 (sandbox, harness): a move out of a suspended sandbox is refused as unreadable, offering the continue, and wakes nothing", async () => {
  const { kit, agentThreadId, call, agent, environmentOf } = await holding({ placement: SANDBOX });
  await kit.idle(agentThreadId, "Waiting.");
  kit.git.offline.add(environmentOf(agentThreadId)); // suspended: bb's git plugin can't read it, and the read doesn't wake it
  const [spawned, sends, reads] = [kit.spawned(), kit.sendAttempts().length, kit.git.calls.length];

  const refused = await call({ placement: WORKTREE });
  assert.ok(isRefusal(refused));
  assert.equal(
    textOf(refused),
    "agent_start is refused: Nothing changed. bb's git plugin can't read a1's environment now (The environment's machine is offline), so what a1 left uncommitted there is unknown. Continue in it instead (leave out placement; that wakes a sleeping sandbox), or call again once it can be read.",
  );
  assert.deepEqual([kit.spawned(), kit.sendAttempts().length, kit.git.calls.length], [spawned, sends, reads + 1], "one read, and no spawn or message that would wake it");
  assert.equal(agent(a1).ended, null);
});

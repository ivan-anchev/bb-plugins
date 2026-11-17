import assert from "node:assert/strict";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { coordinating, HEAD, isRefusal, settled, startedAgent, textOf, threadIn } from "../test-harness.ts";

const a1 = agentIdSchema.parse("a1");
const a2 = agentIdSchema.parse("a2");
const CRITERIA = ["npm test passes", "npm run lint prints no errors"];
const REPORT = { summary: "Retries land with backoff", did: ["Added exponential backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [] };
const DONE = { ...REPORT, status: "done", headSha: HEAD };
const BLOCKED = { ...REPORT, status: "blocked", summary: "Needs the staging key", did: ["Wrote the retry loop, uncommitted"] };
const FAILS = {
  criteria: [
    { criterion: 1, result: "fail", evidence: "$ npm test\nnot ok 13 - backoff caps at 6000" },
    { criterion: 2, result: "pass", evidence: "$ npm run lint\n0 problems" },
  ],
  findings: ["The cap is applied before the jitter."],
};

/** A regional manager whose agent a1 holds a build issue i1 in a worktree; every thread idle, so a message starts a turn. */
async function handedTo(options: Parameters<typeof coordinating>[0] = {}, start: object = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  const { agentThreadId } = await startedAgent(kit, threadId, { doneCriteria: CRITERIA }, start);
  kit.thread(threadId).status = "idle";
  kit.thread(agentThreadId).status = "idle";
  const handover = async (input: object = {}) => kit.call("agent_start", { issue: "i1", ...input }, threadId);
  const row = async () => {
    const issue = (await kit.rpc.board({ coordinatorId })).issues[0] ?? assert.fail("no row");
    return [laneOf(issue), issue.headline];
  };
  const agent = (id: typeof a1) => kit.store.agent(coordinatorId, id) ?? assert.fail(`no agent ${id}`);
  const firstMessage = (agentThread: string) => kit.thread(agentThread).spawnedWith.prompt ?? assert.fail("no first message");
  /** The agent hands off and ends its turn. */
  async function handOff(agentThread: string, report: object = DONE): Promise<string> {
    const answer = textOf(await kit.call("agent_handoff", report, agentThread));
    await kit.idle(agentThread, "Handed off.");
    await settled();
    return answer;
  }
  return { kit, threadId, coordinatorId, agentThreadId, handover, row, agent, firstMessage, handOff };
}

test("a handover stops the holder without archiving it, ends it as replaced, and starts the new agent in its environment, on its branch", async () => {
  const { kit, coordinatorId, agentThreadId, handover, row, agent, firstMessage, handOff } = await handedTo();
  kit.git.changedFiles.set(kit.thread(agentThreadId).environmentId, 1); // a1 leaves a file uncommitted
  await handOff(agentThreadId, BLOCKED);
  const result = textOf(await handover());
  const next = threadIn(result);

  assert.match(result, /^Stopped a1 and started a2 on i1 as @thread:\w+ in a1's worktree, on its branch `bb\/thr_2`, on claude-code opus \(high\), your own provider, model and reasoning level\. It continues a1's work there/);
  assert.match(result, /a1's thread stays stopped, not archived/);
  assert.deepEqual([kit.thread(agentThreadId).status, kit.thread(agentThreadId).archivedAt], ["idle", null], "a1 stopped, never archived");
  assert.equal(agent(a1).ended?.how, "replaced");
  const { spawnedWith, environmentId, environmentBranchName } = kit.thread(next);
  assert.deepEqual(spawnedWith.environment, { type: "reuse", environmentId: kit.thread(agentThreadId).environmentId });
  assert.deepEqual([environmentId, environmentBranchName], [kit.thread(agentThreadId).environmentId, "bb/thr_2"]);
  assert.deepEqual(agent(a2).base, { kind: "joined", from: "a1" });
  assert.deepEqual(agent(a2).checkout, { environmentId, branch: "bb/thr_2", head: HEAD }, "a2 inherits a1's checkout as its handoff read it");
  assert.deepEqual(await row(), ["in-progress", "Working"]);
  assert.deepEqual(kit.store.takeUnread(coordinatorId, Date.now()).filter(({ event }) => event.kind === "returned-to-todo"), [], "nothing returned to Todo");

  const message = firstMessage(next);
  assert.match(message, /^# i1: Add retries\n\nYou are agent a2, working on issue i1\. [^\n]* Your work is this issue: its brief and done-criteria below\. Do it where an earlier agent left it: see Where you work\.\n/);
  assert.match(message, /## Where you work\n\nYou continue a1's work in its environment, on its branch `bb\/thr_2`\. a1 no longer works there\. Its commits are here, and so may be files it left uncommitted, half-done edits included\. Run `git status` and `git log` before you change anything/);
  assert.match(message, /## Earlier work on i1\n\nBefore you, a1 handed off on i1\. Their handoffs, oldest first/);
  assert.match(message, /### a1's handoff: blocked\n\nStatus: blocked\nSummary: Needs the staging key\n\n#### Did\n\n- Wrote the retry loop, uncommitted/);
  assert.ok(message.indexOf("## Done when") < message.indexOf("## Where you work") && message.indexOf("## Earlier work") < message.indexOf("## CREW.md"));

  const late = await kit.call("agent_handoff", BLOCKED, agentThreadId);
  assert.ok(isRefusal(late));
  assert.equal(textOf(late), "agent_handoff is refused: you no longer hold i1 (you were replaced), so nothing reads a handoff from you. Stop here.");
});

test("a pull request the previous agent opened is the new agent's: no second opened wake, and its merge makes the issue Done", async () => {
  const { kit, coordinatorId, agentThreadId, handover, row, firstMessage, handOff } = await handedTo({ verify: false });
  const branch = kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch");
  const pr = (state: "OPEN" | "MERGED") => kit.github.prs.set(branch, { number: 44, state, isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  pr("OPEN");
  await handOff(agentThreadId, { ...DONE, prUrl: "https://github.com/acme/webhooks/pull/44" });
  await kit.tick();
  const opened = () => kit.store.takeUnread(coordinatorId, Date.now()).filter(({ event }) => event.kind === "pr");
  assert.equal(opened().length, 1, "a1's pull request was seen once");

  const result = textOf(await handover());
  assert.match(result, /in a1's worktree, on its branch `bb\/thr_2`, with PR #44,/);
  assert.match(firstMessage(threadIn(result)), /on its branch `bb\/thr_2`, whose pull request is #44: push to it, and don't open another\./);
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  assert.deepEqual(opened(), [], "no second opened wake");

  pr("MERGED");
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  assert.deepEqual(await row(), ["done", "Merged #44"]);
});

test("from default starts clean from the default branch, and its first message still holds the earlier handoffs and verdicts", async () => {
  const { kit, coordinatorId, agentThreadId, handover, firstMessage, handOff } = await handedTo();
  await handOff(agentThreadId);
  const verdict = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
  if (verdict?.state !== "running") assert.fail(`the verdict is ${verdict?.state}`);
  await kit.call("issue_verdict", FAILS, verdict.verifierThreadId);
  await settled();
  await kit.idle(agentThreadId, "Still on it.");

  const result = textOf(await handover({ from: "default" }));
  assert.match(result, /^Stopped a1 and started a2 on i1 as @thread:\w+, on claude-code opus \(high\), your own provider, model and reasoning level\. It starts clean, in its own environment from the default branch\./);
  const next = threadIn(result);
  assert.deepEqual(kit.thread(next).spawnedWith.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
  const message = firstMessage(next);
  assert.doesNotMatch(message, /## Where you work/);
  assert.match(message, /Before you, a1 handed off on i1\. You start clean from the default branch: none of their commits or files are in your environment\./);
  assert.match(message, /### a1's handoff: done\n\nStatus: done\nSummary: Retries land with backoff\nCommit: 0123456789abcdef0123456789abcdef01234567\nPull request: none/);
  assert.match(message, /#### Verdict\n\nFailed at `0123456`: 1 of 2 done-criteria not met\.\n\n##### 1\. npm test passes\n\n\*\*Failed\.\*\* The verifier's evidence:\n\n```\n\$ npm test\nnot ok 13 - backoff caps at 6000\n```\n\n##### Other findings\n\n- The cap is applied before the jitter\./);
});

test("an agent whose thread the user archived is continued in its worktree, which bb keeps a few minutes, and the issue returns to In progress", async () => {
  const { kit, agentThreadId, handover, row, agent } = await handedTo();
  kit.thread(agentThreadId).archivedAt = 5_000;
  await kit.tick();
  assert.deepEqual([agent(a1).ended?.how, await row()], ["archived", ["todo", "Its agent was archived"]]);

  const result = textOf(await handover());
  assert.match(result, /^Started a2 on i1 as @thread:\w+ in a1's worktree, on its branch `bb\/thr_2`/, "no holder to stop");
  assert.deepEqual(kit.thread(threadIn(result)).spawnedWith.environment, { type: "reuse", environmentId: kit.thread(agentThreadId).environmentId });
  assert.deepEqual(await row(), ["in-progress", "Working"]);
});

test("a holder bb still reports stopping is not replaced: the start is refused and nothing starts", async () => {
  const { kit, coordinatorId, agentThreadId, handover, agent } = await handedTo({ stops: "stopping" });
  kit.startTurn(agentThreadId);
  const spawned = kit.spawned();
  const refused = await handover();
  assert.ok(isRefusal(refused));
  assert.equal(textOf(refused), "agent_start is refused: a1 is still stopping, so nothing changed and it still holds i1. Call agent_start again once it has stopped.");
  assert.equal(agent(a1).ended, null);
  assert.deepEqual([kit.spawned(), kit.store.agents(coordinatorId).length], [spawned, 1]);
});

test("a removed environment, or a placement named, is refused before anything stops, offering a clean start", async () => {
  const { kit, agentThreadId, handover, agent } = await handedTo();
  kit.startTurn(agentThreadId);
  const named = await handover({ placement: { kind: "worktree" } });
  assert.ok(isRefusal(named));
  assert.match(textOf(named), /^agent_start is refused: Nothing changed\. A handover continues in a1's environment, and can't move its work to a placement yet: leave out placement, or start clean with from: "default"/);

  kit.environments.destroyed.add(kit.thread(agentThreadId).environmentId);
  const gone = await handover();
  assert.ok(isRefusal(gone));
  assert.match(textOf(gone), /^agent_start is refused: Nothing changed\. bb has removed a1's environment, so its work can't be continued there, and moving it to a new one isn't possible yet: start clean with from: "default"/);
  assert.deepEqual([kit.thread(agentThreadId).status, agent(a1).ended], ["active", null], "a1 still works on i1");
});

test("an environment bb removes between the decision and the spawn ends the new agent spawn-failed; the issue rests in Todo and the result says why", async () => {
  const { kit, agentThreadId, handover, row, agent } = await handedTo();
  kit.startTurn(agentThreadId);
  let answer = (): void => assert.fail("bb never received the stop");
  kit.stopRequests.pending = new Promise((resolve) => (answer = resolve));
  const starting = handover();
  await settled();
  kit.environments.destroyed.add(kit.thread(agentThreadId).environmentId); // the sandbox is reaped while a1 stops
  answer();

  const result = textOf(await starting);
  assert.equal(
    result,
    `bb did not start a2's thread in a1's environment: HTTP 409: Environment unavailable. a1 was stopped and replaced, and stays so. i1 has no agent and rests in Todo: if bb removed a1's environment, start clean with agent_start and from: "default"; otherwise call agent_start again, or tell the user.`,
  );
  assert.deepEqual([agent(a1).ended?.how, agent(a2).ended?.how], ["replaced", "spawn-failed"]);
  assert.deepEqual(await row(), ["todo", "bb never started its agent's thread"]);
});

test("the new agent gets a fix round of its own; the replaced agent's running verifier is stopped, and its late verdict refused", async () => {
  const { kit, coordinatorId, agentThreadId, handover, agent, handOff } = await handedTo();
  const verifierOf = () => {
    const verdict = kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict;
    return verdict?.state === "running" ? verdict.verifierThreadId : assert.fail(`the verdict is ${verdict?.state}`);
  };
  await handOff(agentThreadId);
  await kit.call("issue_verdict", FAILS, verifierOf()); // a1's fix round goes back to it
  await settled();
  await kit.idle(agentThreadId, "Fixed.");
  await handOff(agentThreadId);
  const running = verifierOf();
  assert.equal(agent(a1).fixRounds, 1);

  const next = threadIn(textOf(await handover()));
  assert.equal(kit.thread(running).status, "idle", "a1's verifier stopped");
  assert.equal(kit.thread(running).archivedAt, null, "and never archived");
  assert.deepEqual(kit.store.latestHandoff(coordinatorId, a1)?.check?.verdict, { state: "superseded" });
  assert.ok(isRefusal(await kit.call("issue_verdict", FAILS, running)));

  await kit.idle(next, "Done.");
  await handOff(next);
  const verdict = kit.store.latestHandoff(coordinatorId, a2)?.check?.verdict;
  if (verdict?.state !== "running") assert.fail(`a2's verdict is ${verdict?.state}`);
  assert.equal(kit.thread(verdict.verifierThreadId).spawnedWith.parentThreadId, next, "a2's verifier is its own child");
  assert.deepEqual(kit.thread(verdict.verifierThreadId).spawnedWith.environment, { type: "reuse", environmentId: kit.thread(agentThreadId).environmentId }, "in the shared environment");
  await kit.call("issue_verdict", FAILS, verdict.verifierThreadId);
  await settled();
  assert.equal(agent(a2).fixRounds, 1, "a2's first failed verdict went back to it");
  assert.match(kit.delivered(next).at(-1) ?? "", /^## Verifier findings: 1 of 2 done-criteria not met/);
});

test("a research issue's handover starts clean, with the earlier handoffs in its first message", async () => {
  const { kit, threadId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId, { kind: "research", doneCriteria: ["Which queue?"] });
  await kit.call("agent_handoff", { ...BLOCKED, summary: "Two queues look equal" }, agentThreadId);
  await kit.idle(agentThreadId, "Blocked.");
  await kit.call("agent_stop", { agent: "a1" }, threadId);

  const result = textOf(await kit.call("agent_start", { issue: "i1" }, threadId));
  assert.match(result, /^Started a2 on i1 as @thread:\w+, on claude-code opus \(high\), your own provider, model and reasoning level\. It starts clean/);
  const next = kit.thread(threadIn(result));
  assert.deepEqual(next.spawnedWith.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
  assert.match(next.spawnedWith.prompt ?? "", /## Earlier work on i1\n\nBefore you, a1 handed off on i1\. You start clean[^\n]*\n\n### a1's handoff: blocked\n\nStatus: blocked\nSummary: Two queues look equal/);
});

test("a sandbox agent is continued in its sandbox, which the spawn wakes: nothing reads it first, and the result names it", async () => {
  const sandbox = { placement: { kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } } };
  const { kit, agentThreadId, handover } = await handedTo({}, sandbox);
  const { environmentId } = kit.thread(agentThreadId);
  kit.git.offline.add(environmentId); // suspended: bb's git plugin can't read it
  const reads = kit.git.calls.length;

  const result = textOf(await handover());
  assert.match(result, /^Stopped a1 and started a2 on i1 as @thread:\w+ in a1's boat-sandbox environment, on its branch `bb\/thr_2`/);
  assert.deepEqual(kit.thread(threadIn(result)).spawnedWith.environment, { type: "reuse", environmentId });
  assert.equal(kit.git.calls.length, reads, "the handover read nothing in the sandbox");
  assert.equal(kit.thread(agentThreadId).archivedAt, null);
});

test("an execution named on a handover is checked where the previous agent works before it is stopped; nothing named runs on the manager's own", async () => {
  const { kit, threadId, agentThreadId, handover, agent } = await handedTo({}, { execution: { providerId: "codex", model: "gpt-default" } });
  kit.startTurn(agentThreadId);
  const refused = await handover({ execution: { providerId: "gemini", model: "pro" } });
  assert.ok(isRefusal(refused));
  assert.equal(textOf(refused), "agent_start is refused: Nothing changed. Where the agent would run (a1's environment): bb can't run gemini there. bb can run: claude-code, codex.");
  assert.deepEqual([kit.thread(agentThreadId).status, agent(a1).ended], ["active", null], "a1 keeps i1");

  const result = textOf(await handover());
  assert.match(result, /, on claude-code opus \(high\), your own provider, model and reasoning level\./, "not a1's codex");
  assert.match(textOf(await kit.call("issue_read", { id: "i1" }, threadId)), /### Agents\n\n- a1, replaced, on codex gpt-default \(low\)\n- a2, holds it, on claude-code opus \(high\), @thread:\w+/);
});

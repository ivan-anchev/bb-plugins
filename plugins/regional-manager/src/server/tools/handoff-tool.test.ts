import assert from "node:assert/strict";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { coordinating, isRefusal, ISSUE, settled, startedAgent, textOf } from "../test-harness.ts";

const RETRIES = { ...ISSUE, brief: "Retry failed webhook deliveries with backoff." };
const REPORT = { summary: "Retries land with backoff", did: ["Added exponential backoff"], evidence: ["npm test: 12 passing"], concerns: [], deviations: [], findings: [] };
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const DONE = { status: "done", ...REPORT, headSha: HEAD };
const a1 = agentIdSchema.parse("a1");

async function withAgent({ verify = true } = {}) {
  const { kit, threadId, coordinatorId } = await coordinating({ verify });
  const agentThreadId = (await startedAgent(kit, threadId, RETRIES)).agentThreadId;
  return { kit, threadId, coordinatorId, agentThreadId };
}

test("agent_handoff from a thread that is not an agent is refused, and nothing is stored or rung", async () => {
  const { kit, threadId, coordinatorId } = await withAgent();
  for (const caller of [threadId, "thr_forged"]) {
    const result = await kit.call("agent_handoff", DONE, caller);
    assert.ok(isRefusal(result), caller);
    assert.match(textOf(result), /agent_handoff is refused: only an agent thread/);
  }
  assert.equal(kit.store.latestHandoff(coordinatorId, a1), null);
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);
  assert.deepEqual(kit.sent(), []);
});

test("a handoff is stored whole, trimmed, with its turn and a waived verdict, and reads back as written", async () => {
  const { kit, coordinatorId, agentThreadId } = await withAgent({ verify: false });
  const result = await kit.call("agent_handoff", { ...DONE, summary: "  Retries land with backoff ", prUrl: "https://github.com/acme/webhooks/pull/7" }, agentThreadId);
  assert.match(textOf(result), /^Handed off\. Your regional manager has your report, marked unverified/);

  const { handoff, check } = kit.store.latestHandoff(coordinatorId, a1) ?? assert.fail("no handoff stored");
  const { id, at, ...stored } = handoff;
  const { headSha: _, ...report } = DONE;
  assert.deepEqual(stored, {
    coordinatorId,
    issueId: "WEB-1",
    agentId: a1,
    turnSeq: kit.thread(agentThreadId).turns.at(-1),
    ...report,
    delivery: { kind: "commit", headSha: HEAD, prUrl: "https://github.com/acme/webhooks/pull/7" },
  });
  assert.deepEqual(check?.verdict, { state: "waived" });
  assert.deepEqual(kit.store.handoff(id), kit.store.latestHandoff(coordinatorId, a1));
});

test("a handoff records where the agent's work is and what its thread runs on now, so neither is read from it again", async () => {
  const { kit, threadId, coordinatorId, agentThreadId } = await withAgent({ verify: false });
  const environmentId = kit.environment(agentThreadId);
  kit.git.checkouts.set(environmentId, "retries");
  // The user switches the agent's model in bb's composer before it hands off.
  kit.thread(agentThreadId).execution = { model: "sonnet", reasoningLevel: "low", serviceTier: "default", permissionMode: "auto" };
  await kit.call("agent_handoff", DONE, agentThreadId);

  const agent = kit.store.agent(coordinatorId, a1) ?? assert.fail("no agent");
  assert.deepEqual(agent.checkout, { environmentId, branch: "retries", head: HEAD });
  assert.deepEqual(agent.execution, { providerId: "claude-code", model: "sonnet", reasoningLevel: "low" });
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId)), /- a1, holds it, on claude-code sonnet \(low\)/);
});

test("an agent's latest handoff is its newest, never another agent's, and an earlier one still reads by its id", async () => {
  const { kit, threadId, coordinatorId, agentThreadId } = await withAgent();
  const otherThreadId = (await startedAgent(kit, threadId, { ...RETRIES, title: "Dead letters" })).agentThreadId;
  await kit.call("agent_handoff", { ...REPORT, status: "blocked" }, agentThreadId);
  const blocked = kit.store.latestHandoff(coordinatorId, a1) ?? assert.fail("no handoff stored");
  await kit.startTurn(agentThreadId);
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.call("agent_handoff", { ...REPORT, status: "gave-up" }, otherThreadId);

  assert.equal(kit.store.latestHandoff(coordinatorId, a1)?.handoff.status, "done");
  assert.equal(kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a2"))?.handoff.status, "gave-up");
  assert.deepEqual(kit.store.handoff(blocked.handoff.id), blocked);
});

test("a handoff outside its bounds is rejected, and a done one needs its commit", async () => {
  const { kit, coordinatorId, agentThreadId } = await withAgent();
  const { headSha: _, ...doneWithoutCommit } = DONE;
  const commitless = await kit.call("agent_handoff", doneWithoutCommit, agentThreadId);
  assert.ok(isRefusal(commitless));
  assert.equal(textOf(commitless), "agent_handoff is refused and nothing was saved: A done handoff needs headSha: the output of `git rev-parse HEAD` after your last commit.");
  for (const input of [
    { ...DONE, headSha: "abc123" },
    { ...DONE, summary: "x".repeat(121) },
    { ...DONE, summary: "Two\nlines" },
    { ...DONE, evidence: Array.from({ length: 51 }, () => "ran it") },
    { ...DONE, evidence: ["x".repeat(2_001)] },
    { ...DONE, prUrl: "javascript:alert(1)" },
    { ...DONE, status: "finished" },
  ]) {
    await assert.rejects(kit.call("agent_handoff", input, agentThreadId));
  }
  assert.equal(kit.store.latestHandoff(coordinatorId, a1), null);

  assert.ok(!isRefusal(await kit.call("agent_handoff", { ...REPORT, status: "blocked" }, agentThreadId)), "blocked needs no commit");
});

test("with verification off, once its turn ends a done handoff is In review as Unverified, and a blocked or gave-up one Needs you", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const started: [string, Record<string, unknown>][] = [];
  for (const [title, input] of [
    ["Done", DONE],
    ["Blocked", { ...REPORT, status: "blocked", summary: "Needs a staging key" }],
    ["Gave up", { ...REPORT, status: "gave-up", summary: "The queue API rejects batches" }],
  ] as const) {
    started.push([(await startedAgent(kit, threadId, { ...RETRIES, title })).agentThreadId, input]);
  }
  for (const [agentThreadId, input] of started) {
    await kit.call("agent_handoff", input, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
  }

  assert.deepEqual((await kit.rpc.board({ coordinatorId })).issues.map((issue) => [issue.id, laneOf(issue), issue.headline]), [
    ["WEB-1", "in-review", "Unverified: Retries land with backoff"],
    ["WEB-2", "needs-you", "Blocked: Needs a staging key"],
    ["WEB-3", "needs-you", "Gave up: The queue API rejects batches"],
  ]);
});

test("a handoff of 50 evidence items of 2,000 characters comes back whole from crew_catch_up and issue_read", async () => {
  const { kit, threadId, agentThreadId } = await withAgent({ verify: false });
  // Each item is numbered at its start and ends in "$", so a missing or cut one can't match.
  const evidence = Array.from({ length: 50 }, (_, i) => `${String(i).padStart(2, "0")}${"e".repeat(1_997)}$`);
  await kit.call("agent_handoff", { ...DONE, evidence }, agentThreadId);

  for (const text of [textOf(await kit.call("crew_catch_up", {}, threadId)), textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId))]) {
    for (const item of evidence) assert.ok(text.includes(`- ${item}`), `item ${item.slice(0, 2)} is missing or cut`);
    assert.match(text, /Status: done\nSummary: Retries land with backoff\nCommit: 0123456789abcdef0123456789abcdef01234567\nPull request: none/);
    assert.match(text, /#### Verdict\n\nUnverified: verification was off, so nobody has checked it against the done-criteria\./);
  }
});

test("issue_read places the issue by its agent's thread once it has had a turn since its handoff, and keeps the handoff on record", async () => {
  const { kit, threadId, agentThreadId } = await withAgent({ verify: false });
  await kit.call("agent_handoff", DONE, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId)), /^## WEB-1: Add retries\n\nBuild\. In review: Unverified: Retries land with backoff\./);

  await kit.startTurn(agentThreadId);
  const text = textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId));
  assert.match(text, /^## WEB-1: Add retries\n\nBuild\. In progress: Working\./);
  assert.match(text, /### Its record\n\n#### a1's handoff\n\nStatus: done/);
});

test("issue_read ends its status line with one full stop when the agent's summary already ends with one", async () => {
  const { kit, threadId, agentThreadId } = await withAgent({ verify: false });
  await kit.call("agent_handoff", { ...DONE, summary: "Added notes/p1.md with exactly one line: p1." }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId)), /^## WEB-1: Add retries\n\nBuild\. In review: Unverified: Added notes\/p1\.md with exactly one line: p1\. Thread: /);
});

test("a handoff still reading the agent's checkout when the agent is stopped is refused, and stores, checks and starts nothing", async () => {
  const { kit, threadId, coordinatorId, agentThreadId } = await withAgent();
  const before = kit.store.agent(coordinatorId, a1) ?? assert.fail("no agent");
  kit.git.checkouts.set(kit.environment(agentThreadId), "retries");
  kit.thread(agentThreadId).execution = { model: "sonnet", reasoningLevel: "low", serviceTier: "default", permissionMode: "auto" };
  kit.git.holding = true;
  const handingOff = kit.call("agent_handoff", DONE, agentThreadId);
  await settled();
  assert.equal(kit.git.held.length, 1, "the checkout read is held");

  assert.match(textOf(await kit.call("agent_stop", { agent: "a1" }, threadId)), /^a1 is stopped/);
  kit.git.held.splice(0).forEach((release) => release());
  const result = await handingOff;
  await settled();

  assert.ok(isRefusal(result));
  assert.equal(textOf(result), "agent_handoff is refused: you no longer hold WEB-1 (you were stopped), so nothing reads a handoff from you. Stop here.");
  const after = kit.store.agent(coordinatorId, a1) ?? assert.fail("no agent");
  assert.equal(kit.store.latestHandoff(coordinatorId, a1), null);
  assert.deepEqual([after.checkout, after.execution, after.ended?.left], [before.checkout, before.execution, null]);
  assert.equal(kit.spawned(), 2, "no verifier started");
});

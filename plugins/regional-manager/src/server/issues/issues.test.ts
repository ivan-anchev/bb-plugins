import assert from "node:assert/strict";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinating, HEAD, isRefusal, ISSUE, settled, textOf, threadIn } from "../test-harness.ts";

const ISSUE_ID = issueIdSchema.parse("i1");
const REPORT = { summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [] };

async function managing(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  const call = (tool: string, input: object) => kit.call(tool, input, threadId);
  const update = async (input: object) => {
    const result = await call("issue_update", { id: "i1", ...input });
    return { refused: isRefusal(result), text: textOf(result) };
  };
  const statuses = async () => (await kit.rpc.board({ coordinatorId })).issues.map((issue) => [issue.id, laneOf(issue)]);
  return { kit, threadId, coordinatorId, call, update, statuses };
}

test("issue_create files a build issue in Todo, or in Backlog, numbered per regional manager, and never reuses an id", async () => {
  const { kit, call, statuses } = await managing();
  assert.equal(textOf(await call("issue_create", ISSUE)), "Filed i1 (build) in Todo.");
  assert.equal(textOf(await call("issue_create", { ...ISSUE, title: "Dead letters", status: "backlog" })), "Filed i2 (build) in Backlog.");
  assert.deepEqual(await statuses(), [
    ["i1", "todo"],
    ["i2", "backlog"],
  ]);

  assert.equal(textOf(await call("issue_update", { id: "i2", status: "canceled" })), "Updated i2.");
  assert.equal(textOf(await call("issue_create", ISSUE)), "Filed i3 (build) in Todo.");
  const other = await kit.startManager("Retire the cron box");
  assert.equal(textOf(await kit.call("issue_create", ISSUE, other.threadId)), "Filed i1 (build) in Todo.");
});

test("issue_create rejects a missing or unknown kind, a blank or a thirteenth criterion, or a field it doesn't take, and files nothing", async () => {
  const { kit, coordinatorId, call } = await managing();
  const { kind: _, ...kindless } = ISSUE;
  for (const input of [kindless, { ...ISSUE, kind: "chore" }, { ...ISSUE, doneCriteria: [" "] }, { ...ISSUE, doneCriteria: Array.from({ length: 13 }, (_, i) => `criterion ${i}`) }, { ...ISSUE, draft: true }]) {
    await assert.rejects(call("issue_create", input));
  }
  assert.deepEqual(kit.store.issues(coordinatorId), []);
});

test("issue_update changes the plan it names, and only a status the manager may write: the others are rejected by the schema", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  await call("issue_create", { ...ISSUE, brief: undefined, doneCriteria: undefined });
  assert.deepEqual(await update({ title: "Retry deliveries", brief: "Back off.", doneCriteria: ["npm test passes"] }), { refused: false, text: "Updated i1." });
  assert.deepEqual(kit.store.issue(coordinatorId, ISSUE_ID)?.brief, "Back off.");
  for (const status of ["in-progress", "verifying", "in-review"]) await assert.rejects(call("issue_update", { id: "i1", status }), status);
  assert.deepEqual(await update({ status: "backlog" }), { refused: false, text: "Updated i1." });
  const unknown = await call("issue_update", { id: "i9", title: "Nothing" });
  assert.ok(isRefusal(unknown));
  assert.equal(textOf(unknown), "You have no issue i9. crew_catch_up lists your issues.");
});

test("issue_update with only a decision records it on the issue, changing nothing else; issue_read, the board's detail and the next agent started on it show it, the latest last", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  await call("issue_create", ISSUE);
  assert.match(textOf(await call("issue_read", { id: "i1" })), /### Decisions\n\nNone yet\./);
  const before = kit.store.issue(coordinatorId, ISSUE_ID);

  const first = "Retries cap at 5: the provider rate-limits beyond that.";
  const second = "Cap at 3 instead.\nThe user's SLA is tighter than the provider's limit.";
  assert.deepEqual(await update({ decision: first }), { refused: false, text: "Updated i1." });
  assert.deepEqual(await update({ decision: second }), { refused: false, text: "Updated i1." });
  assert.deepEqual(kit.store.issue(coordinatorId, ISSUE_ID), before, "the issue itself is unchanged");

  const read = textOf(await call("issue_read", { id: "i1" }));
  assert.match(read, /### Decisions\n\nOldest first; where two disagree, the later one stands\.\n\n- \S+: Retries cap at 5: the provider rate-limits beyond that\.\n- \S+: Cap at 3 instead\.\n  The user's SLA is tighter than the provider's limit\./);
  const detail = await kit.rpc.issue({ coordinatorId, issueId: ISSUE_ID });
  assert.deepEqual(detail.decisions.map((entry) => (entry.kind === "recorded" ? entry.text : entry)), [first, second]);

  const prompt = kit.thread(threadIn(textOf(await call("agent_start", { issue: "i1" })))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /## Decisions on i1\n\n[^\n]*the later one wins\.\n\n- \S+: Retries cap at 5: the provider rate-limits beyond that\.\n- \S+: Cap at 3 instead\.\n  The user's SLA/);
});

test("issue_update refuses a blank decision, and records nothing", async () => {
  const { coordinatorId, call, kit } = await managing();
  await call("issue_create", ISSUE);
  await assert.rejects(call("issue_update", { id: "i1", decision: "  " }));
  assert.deepEqual((await kit.rpc.issue({ coordinatorId, issueId: ISSUE_ID })).decisions, []);
});

test("while an agent holds an issue it can't be canceled or rested, and Done is accepted only from In review", async () => {
  const { kit, call, update, statuses } = await managing({ verify: false });
  await call("issue_create", ISSUE);
  const agentThreadId = threadIn(textOf(await call("agent_start", { issue: "i1" })));

  for (const [status, words] of [
    ["canceled", "canceled"],
    ["todo", "moved to Todo"],
    ["backlog", "moved to Backlog"],
  ]) {
    assert.deepEqual(await update({ status }), { refused: true, text: `a1 holds i1, so it can't be ${words}. Stop a1 with agent_stop first.` });
  }
  assert.deepEqual(await update({ status: "done" }), { refused: true, text: "i1 is In progress (Working), so it can't be marked Done: only an issue In review can." });

  await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.deepEqual(await statuses(), [["i1", "in-review"]]);
  assert.deepEqual(await update({ status: "done" }), { refused: false, text: "Updated i1." });
  assert.deepEqual(await statuses(), [["i1", "done"]]);
  await call("agent_stop", { agent: "a1" });
  assert.deepEqual(await update({ status: "todo" }), { refused: true, text: "i1 is Done (Accepted), and Done is final." });
});

test("an accepted issue stays Done when its agent, which took another turn since, is stopped, and its manager hears nothing returned", async () => {
  const { kit, coordinatorId, call, update, statuses } = await managing({ verify: false });
  await call("issue_create", ISSUE);
  const agentThreadId = threadIn(textOf(await call("agent_start", { issue: "i1" })));
  await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.deepEqual(await update({ status: "done" }), { refused: false, text: "Updated i1." });
  await kit.startTurn(agentThreadId);
  await kit.idle(agentThreadId, "Tidied up.");

  await call("agent_stop", { agent: "a1" });
  assert.deepEqual(await statuses(), [["i1", "done"]]);
  assert.ok(!kit.store.unannounced(coordinatorId).some(({ event }) => event.kind === "returned-to-todo"), "nothing returned to Todo");
});

test("an issue no agent holds is canceled, and reopened into Todo, ready again; no agent starts on a canceled one", async () => {
  const { call, update, statuses } = await managing();
  await call("issue_create", ISSUE);
  assert.deepEqual(await update({ status: "canceled" }), { refused: false, text: "Updated i1." });
  assert.deepEqual(await statuses(), [["i1", "canceled"]]);
  assert.equal(textOf(await call("agent_start", { issue: "i1" })), "agent_start is refused: i1 is canceled, so no agent can start on it.");
  assert.deepEqual(await update({ status: "todo" }), { refused: false, text: "Updated i1. Now ready: i1." });
  assert.deepEqual(await statuses(), [["i1", "todo"]]);
});

test("a verifier named on an issue is stored with its catalog default reasoning level, shown, and cleared with null", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  assert.equal(textOf(await call("issue_create", { ...ISSUE, verifier: { providerId: "claude-code", model: "opus" } })), "Filed i1 (build) in Todo. Its done handoffs are checked on claude-code opus (high).");
  assert.deepEqual(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, { providerId: "claude-code", model: "opus", reasoningLevel: "high" });
  assert.match(textOf(await call("issue_read", { id: "i1" })), /### Verifier\n\nNamed: claude-code opus \(high\)\./);

  assert.deepEqual(await update({ verifier: { providerId: "codex", model: "gpt-default", reasoningLevel: "high" } }), {
    refused: false,
    text: "Updated i1. codex gpt-default (high) is now i1's first choice of verifier for its done handoffs, and its final check as a parent, from the next one on: each runs on it when bb lists it where the check runs and no agent whose work it checks ran on it. A check already running keeps its own.",
  });
  assert.deepEqual(await update({ verifier: null }), { refused: false, text: "Updated i1. i1's verifier is the plugin's pick again." });
  assert.equal(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, null);
});

test("a verifier bb can't run is refused as an agent's execution is, and changes nothing", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  const unknown = await call("issue_create", { ...ISSUE, verifier: { providerId: "gemini", model: "pro" } });
  assert.ok(isRefusal(unknown));
  assert.equal(textOf(unknown), "No issue filed. On bb's primary machine: bb can't run gemini there. bb can run: claude-code, codex.");
  assert.deepEqual(kit.store.issues(coordinatorId), []);

  await call("issue_create", ISSUE);
  assert.deepEqual(await update({ verifier: { providerId: "claude-code", model: "gpt-9" } }), {
    refused: true,
    text: "On bb's primary machine: claude-code has no model gpt-9 there. Its models: opus (default), sonnet. bb can run: claude-code, codex.",
  });
  assert.equal(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, null);
});

test("agent_start and issue_update naming the same model as its verifier, run at once, don't both succeed", async () => {
  const { kit, coordinatorId, call } = await managing();
  await call("issue_create", ISSUE);
  const codex = { providerId: "codex", model: "gpt-default" };
  const [started, updated] = await Promise.all([call("agent_start", { issue: "i1", execution: codex }), call("issue_update", { id: "i1", verifier: codex })]);
  assert.deepEqual([started, updated].map(isRefusal).sort(), [false, true]);
  assert.ok(kit.store.agents(coordinatorId).length === 0 || kit.store.issue(coordinatorId, ISSUE_ID)?.verifier === null, "an agent and a verifier on one model");
});

test("an issue_update naming a verifier is refused when an agent on that model started while bb's catalog was read", async () => {
  const { kit, coordinatorId, call } = await managing();
  await call("issue_create", ISSUE);
  kit.providers.holding = true;
  const updating = call("issue_update", { id: "i1", verifier: { providerId: "claude-code", model: "opus" } });
  await settled();
  assert.equal(kit.providers.held.length, 1, "the verifier's catalog read is held");
  assert.match(textOf(await call("agent_start", { issue: "i1" })), /^Started a1 on i1 .* on claude-code opus \(high\), your own/);
  kit.providers.held.splice(0).forEach((release) => release());

  const updated = await updating;
  assert.ok(isRefusal(updated));
  assert.match(textOf(updated), /^a1 holds i1 on claude-code opus \(high\), so a verifier on it couldn't check that work independently\./);
  assert.equal(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, null);
});

test("a verifier on the model of the agent holding the issue is refused naming the agent, offering the other change", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  await call("issue_create", ISSUE);
  await call("agent_start", { issue: "i1", execution: { providerId: "codex", model: "gpt-default" } });
  assert.deepEqual(await update({ verifier: { providerId: "codex", model: "gpt-default" } }), {
    refused: true,
    text: "a1 holds i1 on codex gpt-default (low), so a verifier on it couldn't check that work independently. Name another model, or stop a1 with agent_stop and start an agent on another execution.",
  });
  assert.equal(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import { randomUUID } from "node:crypto";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { handoffIdSchema } from "../../model/agent/handoff.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { coordinating, failsVerification, HEAD, holdingThreadLists, isRefusal, ISSUE, settled, startedAgent, textOf, threadIn, toCap, withoutLinks } from "../test-harness.ts";

const ISSUE_ID = issueIdSchema.parse("WEB-1");
const REPORT = { summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [] };

async function managing(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  const call = (tool: string, input: object) => kit.call(tool, input, threadId);
  const update = async (input: object) => {
    const result = await call("issue_update", { id: "WEB-1", ...input });
    // why without links: the update's links are the link test's; here, what it changed.
    return { refused: isRefusal(result), text: withoutLinks(textOf(result)) };
  };
  const statuses = async () => (await kit.rpc.board({ coordinatorId })).issues.map((issue) => [issue.id, laneOf(issue)]);
  return { kit, threadId, coordinatorId, call, update, statuses };
}

test("issue_create files a build issue in Todo, or in Backlog, numbered per regional manager, and never reuses an id", async () => {
  const { kit, coordinatorId, call, statuses } = await managing();
  const link = (id: string, coordinator: string = coordinatorId) => `[${id}](/plugins/regional-manager/regional-managers/issue/${coordinator}/${id})`;
  assert.equal(textOf(await call("issue_create", ISSUE)), `Filed WEB-1 (build) in Todo. Link: ${link("WEB-1")}`);
  assert.equal(textOf(await call("issue_create", { ...ISSUE, title: "Dead letters", status: "backlog" })), `Filed WEB-2 (build) in Backlog. Link: ${link("WEB-2")}`);
  assert.deepEqual(await statuses(), [
    ["WEB-1", "todo"],
    ["WEB-2", "backlog"],
  ]);

  assert.equal(textOf(await call("issue_update", { id: "WEB-2", status: "canceled" })), `Updated WEB-2. Link: ${link("WEB-2")}`);
  assert.equal(textOf(await call("issue_create", ISSUE)), `Filed WEB-3 (build) in Todo. Link: ${link("WEB-3")}`);
  const other = await kit.startManager("Retire the cron box");
  assert.equal(textOf(await kit.call("issue_create", ISSUE, other.threadId)), `Filed WEB-1 (build) in Todo. Link: ${link("WEB-1", other.coordinatorId)}`, "the same id, another manager's link");
});

test("each issue's link, and each related issue's, is in the catch-up's row, issue_create, issue_read and issue_update, and the rules tell the manager to name issues to the user by it, never bare or in code", async () => {
  const { kit, threadId, coordinatorId, call } = await managing();
  const link = (id: string) => `[${id}](/plugins/regional-manager/regional-managers/issue/${coordinatorId}/${id})`;
  assert.ok(textOf(await call("issue_create", ISSUE)).endsWith(` Link: ${link("WEB-1")}`));
  await call("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["WEB-1"] });

  const caughtUp = textOf(await call("crew_catch_up", {}));
  assert.ok(caughtUp.includes(`\n- WEB-1 "Add retries" (Build; no agent): Not started; blocks ${link("WEB-2")} (Todo); link: ${link("WEB-1")}\n`), caughtUp);
  assert.ok(caughtUp.includes(`\n- WEB-2 "Dead letters" (Build; no agent): Not started; blocked by ${link("WEB-1")} (Todo); link: ${link("WEB-2")}\n`), caughtUp);
  assert.ok(caughtUp.includes(`\nReady: ${link("WEB-1")} (in Todo,`), "the ready issues by their links");
  const read = textOf(await call("issue_read", { id: "WEB-2" }));
  assert.ok(read.startsWith(`## WEB-2: Dead letters\n\nBuild. Todo: Not started. Blocked by ${link("WEB-1")} (Todo). Thread: no thread. Link: ${link("WEB-2")}\n`), read);
  assert.ok(read.includes(`\nDepends on: ${link("WEB-1")} (Todo).\nBlocks: nothing.\n`), read);

  assert.equal(textOf(await call("issue_update", { id: "WEB-1", status: "backlog" })), `Updated WEB-1. Link: ${link("WEB-1")}`);
  assert.equal(textOf(await call("issue_update", { id: "WEB-1", status: "canceled" })), `Updated WEB-1. Now ready: ${link("WEB-2")}. Link: ${link("WEB-1")}`, "an issue it made ready, by its link too");

  const sub = textOf(await call("issue_create", { ...ISSUE, title: "Retry budget", parent: "WEB-2" }));
  assert.ok(sub.startsWith(`Filed WEB-3 (build) as a sub-issue of ${link("WEB-2")} in Todo`), sub);
  assert.ok(textOf(await call("crew_catch_up", {})).includes(`- WEB-3 "Retry budget" (Build; no agent, under ${link("WEB-2")})`), "its parent by its link");

  const rules = kit.configurationFor(threadId, {}).instructions ?? "";
  assert.match(rules, /Name an issue to the user by its link, exactly as crew_catch_up, issue_create, issue_update and issue_read give it, .*: never by its bare id, and never inside code or a code block\./);
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
  assert.deepEqual(await update({ title: "Retry deliveries", brief: "Back off.", doneCriteria: ["npm test passes"] }), { refused: false, text: "Updated WEB-1." });
  assert.deepEqual(kit.store.issue(coordinatorId, ISSUE_ID)?.brief, "Back off.");
  for (const status of ["in-progress", "verifying", "reviewing"]) await assert.rejects(call("issue_update", { id: "WEB-1", status }), status);
  assert.deepEqual(await update({ status: "backlog" }), { refused: false, text: "Updated WEB-1." });
  const unknown = await call("issue_update", { id: "WEB-9", title: "Nothing" });
  assert.ok(isRefusal(unknown));
  assert.equal(textOf(unknown), "You have no issue WEB-9. crew_catch_up lists your issues.");
});

test("issue_update with only a decision records it on the issue, changing nothing else; issue_read, the board's detail and the next agent started on it show it, the latest last", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  await call("issue_create", ISSUE);
  assert.match(textOf(await call("issue_read", { id: "WEB-1" })), /### Decisions\n\nNone yet\./);
  const before = kit.store.issue(coordinatorId, ISSUE_ID);

  const first = "Retries cap at 5: the provider rate-limits beyond that.";
  const second = "Cap at 3 instead.\nThe user's SLA is tighter than the provider's limit.";
  assert.deepEqual(await update({ decision: first }), { refused: false, text: "Updated WEB-1." });
  assert.deepEqual(await update({ decision: second }), { refused: false, text: "Updated WEB-1." });
  assert.deepEqual(kit.store.issue(coordinatorId, ISSUE_ID), before, "the issue itself is unchanged");

  const read = textOf(await call("issue_read", { id: "WEB-1" }));
  assert.match(read, /### Decisions\n\nOldest first; where two disagree, the later one wins\.\n\n- \S+: Retries cap at 5: the provider rate-limits beyond that\.\n- \S+: Cap at 3 instead\.\n  The user's SLA is tighter than the provider's limit\./);
  assert.deepEqual(await recorded(kit, coordinatorId), [first, second]);

  const prompt = kit.thread(threadIn(textOf(await call("agent_start", { issue: "WEB-1" })))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /## Decisions on WEB-1\n\n[^\n]*part of your work, as your brief is\.\n\nOldest first; where two disagree, the later one wins\.\n\n- \S+: Retries cap at 5: the provider rate-limits beyond that\.\n- \S+: Cap at 3 instead\.\n  The user's SLA/);
});

/** The decisions recorded on WEB-1, as its feed sends them. */
async function recorded(kit: Awaited<ReturnType<typeof managing>>["kit"], coordinatorId: CoordinatorId): Promise<string[]> {
  const { entries } = await kit.rpc.issueFeed({ coordinatorId, issueId: ISSUE_ID });
  return entries.flatMap((entry) => (entry.kind === "decision" && entry.decision.kind === "recorded" ? [entry.decision.text] : []));
}

test("issue_update refuses a blank decision, and records nothing", async () => {
  const { coordinatorId, call, kit } = await managing();
  await call("issue_create", ISSUE);
  await assert.rejects(call("issue_update", { id: "WEB-1", decision: "  " }));
  assert.deepEqual(await recorded(kit, coordinatorId), []);
});

test("while an agent holds an issue it can't be canceled or rested, and Done is accepted only from In review", async () => {
  const { kit, call, update, statuses } = await managing({ verify: false });
  await call("issue_create", ISSUE);
  const agentThreadId = threadIn(textOf(await call("agent_start", { issue: "WEB-1" })));

  for (const [status, words] of [
    ["canceled", "canceled"],
    ["todo", "moved to Todo"],
    ["backlog", "moved to Backlog"],
  ]) {
    assert.deepEqual(await update({ status }), { refused: true, text: `a1 holds WEB-1, so it can't be ${words}. Stop a1 with agent_stop first.` });
  }
  assert.deepEqual(await update({ status: "done" }), { refused: true, text: "WEB-1 is In progress (Working), so it can't be marked Done: only an issue In review can." });

  await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.deepEqual(await statuses(), [["WEB-1", "in-review"]]);
  assert.deepEqual(await update({ status: "done" }), { refused: false, text: "Updated WEB-1." });
  assert.deepEqual(await statuses(), [["WEB-1", "done"]]);
  await call("agent_stop", { agent: "a1" });
  assert.deepEqual(await update({ status: "todo" }), { refused: true, text: "WEB-1 is Done (Accepted), and Done is final." });
});

test("an accepted issue stays Done when its agent, which took another turn since, is stopped, and its manager hears nothing returned", async () => {
  const { kit, coordinatorId, call, update, statuses } = await managing({ verify: false });
  await call("issue_create", ISSUE);
  const agentThreadId = threadIn(textOf(await call("agent_start", { issue: "WEB-1" })));
  await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.deepEqual(await update({ status: "done" }), { refused: false, text: "Updated WEB-1." });
  await kit.startTurn(agentThreadId);
  await kit.idle(agentThreadId, "Tidied up.");

  await call("agent_stop", { agent: "a1" });
  assert.deepEqual(await statuses(), [["WEB-1", "done"]]);
  assert.ok(!kit.store.unannounced(coordinatorId).some(({ event }) => event.kind === "returned-to-todo"), "nothing returned to Todo");
});

test("an issue no agent holds is canceled, and reopened into Todo, ready again; no agent starts on a canceled one", async () => {
  const { kit, coordinatorId, call, update, statuses } = await managing();
  await call("issue_create", ISSUE);
  assert.deepEqual(await update({ status: "canceled" }), { refused: false, text: "Updated WEB-1." });
  assert.deepEqual(await statuses(), [["WEB-1", "canceled"]]);
  const closed = kit.store.issue(coordinatorId, ISSUE_ID)?.closed;
  // why a wait: an edit is timed by the wall clock, and a cancel retried a moment later must not close it again.
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await update({ status: "canceled" }), { refused: false, text: "Updated WEB-1." }, "the same cancel again, as a retried call");
  assert.deepEqual(kit.store.issue(coordinatorId, ISSUE_ID)?.closed, closed, "keeps its close and its time");
  assert.deepEqual(
    kit.store.logOf(coordinatorId, ISSUE_ID).flatMap(({ event }) => (event.kind === "closed" ? [event] : [])),
    [{ kind: "closed", as: "canceled" }],
    "and logs one close",
  );
  assert.equal(textOf(await call("agent_start", { issue: "WEB-1" })), "agent_start is refused: WEB-1 is canceled, so no agent can start on it.");
  assert.deepEqual(await update({ status: "todo" }), { refused: false, text: "Updated WEB-1. Now ready: WEB-1." });
  assert.deepEqual(await statuses(), [["WEB-1", "todo"]]);
});

test("a verifier named on an issue is stored with its catalog default reasoning level, shown, and cleared with null", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  assert.match(textOf(await call("issue_create", { ...ISSUE, verifier: { providerId: "claude-code", model: "opus" } })), /^Filed WEB-1 \(build\) in Todo\. Its done handoffs are checked on claude-code opus \(high\)\. Link: /);
  assert.deepEqual(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, { providerId: "claude-code", model: "opus", reasoningLevel: "high" });
  assert.match(textOf(await call("issue_read", { id: "WEB-1" })), /### Verifier\n\nNamed: claude-code opus \(high\)\./);

  assert.deepEqual(await update({ verifier: { providerId: "codex", model: "gpt-default", reasoningLevel: "high" } }), {
    refused: false,
    text: "Updated WEB-1. codex gpt-default (high) is now WEB-1's first choice of verifier for its done handoffs, and its final check as a parent, from the next one on: each runs on it when bb lists it where the check runs and no agent whose work it checks ran on it. A check already running keeps its own.",
  });
  assert.deepEqual(await update({ verifier: null }), { refused: false, text: "Updated WEB-1. WEB-1's verifier is the plugin's pick again." });
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
  const [started, updated] = await Promise.all([call("agent_start", { issue: "WEB-1", execution: codex }), call("issue_update", { id: "WEB-1", verifier: codex })]);
  assert.deepEqual([started, updated].map(isRefusal).sort(), [false, true]);
  assert.ok(kit.store.agents(coordinatorId).length === 0 || kit.store.issue(coordinatorId, ISSUE_ID)?.verifier === null, "an agent and a verifier on one model");
});

test("an issue_update naming a verifier is refused when an agent on that model started while bb's catalog was read", async () => {
  const { kit, coordinatorId, call } = await managing();
  await call("issue_create", ISSUE);
  kit.providers.holding = true;
  const updating = call("issue_update", { id: "WEB-1", verifier: { providerId: "claude-code", model: "opus" } });
  await settled();
  assert.equal(kit.providers.held.length, 1, "the verifier's catalog read is held");
  assert.match(textOf(await call("agent_start", { issue: "WEB-1" })), /^Started a1 on WEB-1 .* on claude-code opus \(high\), your own/);
  kit.providers.held.splice(0).forEach((release) => release());

  const updated = await updating;
  assert.ok(isRefusal(updated));
  assert.match(textOf(updated), /^a1 holds WEB-1 on claude-code opus \(high\), so a verifier on it couldn't check that work independently\./);
  assert.equal(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, null);
});

test("a verifier on the model of the agent holding the issue is refused naming the agent, offering the other change", async () => {
  const { kit, coordinatorId, call, update } = await managing();
  await call("issue_create", ISSUE);
  await call("agent_start", { issue: "WEB-1", execution: { providerId: "codex", model: "gpt-default" } });
  assert.deepEqual(await update({ verifier: { providerId: "codex", model: "gpt-default" } }), {
    refused: true,
    text: "a1 holds WEB-1 on codex gpt-default (high), so a verifier on it couldn't check that work independently. Name another model, or stop a1 with agent_stop and start an agent on another execution.",
  });
  assert.equal(kit.store.issue(coordinatorId, ISSUE_ID)?.verifier, null);
});

/** WEB-1 with its agent a1, after `on` failed its first verdict (failsVerification), which went back to a1 as its fix round; the board's row and helpers to read what an accept wrote. */
async function failedOnce(on: "criterion" | "review" = "review", options: Parameters<typeof coordinating>[0] = {}) {
  const managed = await managing(options);
  const { kit, threadId, coordinatorId } = managed;
  const { agentThreadId } = await startedAgent(kit, threadId);
  await failsVerification(kit, coordinatorId, agentThreadId, on);
  const row = async () => {
    const issue = (await kit.rpc.board({ coordinatorId })).issues.find(({ id }) => id === "WEB-1") ?? assert.fail("no row");
    return { lane: laneOf(issue), headline: issue.headline };
  };
  /** The issue's latest check, as the store reads it. */
  const latest = () => kit.store.record(coordinatorId, ISSUE_ID).flatMap(({ check }) => (check === null ? [] : [check])).at(-1) ?? assert.fail("no check");
  return { ...managed, agentThreadId, row, latest };
}

const REASON = "Every criterion passes; the backoff cap is polish the user can take later.";

test("an accept into In review is refused without a decision, and with one it places the issue In review, records the decision, stamps the check and files a follow-up holding the unfixed must-fix", async () => {
  const { kit, coordinatorId, call, update, row, latest } = await failedOnce();
  assert.deepEqual(await update({ status: "in-review" }), {
    refused: true,
    text: 'WEB-1 wasn\'t accepted: an accept into In review needs a decision saying why its work is accepted as it is. Send status "in-review" again with decision.',
  });
  assert.equal(latest().acceptedAt, null, "nothing written");

  const accepted = await update({ status: "in-review", decision: REASON });
  assert.equal(accepted.refused, false);
  assert.equal(
    accepted.text,
    "Updated WEB-1. It is accepted as it is, into In review: its pull request stays watched, issues that depend on it stay blocked, and its merge makes it Done. The review findings it was accepted with, its unfixed must-fixes among them, are filed as WEB-2, top-level in Backlog and depending on WEB-1: agent_start on it is refused until WEB-1 is Done. It has no done-criteria yet: plan it with issue_update, or cancel it if the user doesn't want it. a1 still holds WEB-1: stop it with agent_stop, as a done handoff of its would replace the accepted work.",
  );
  assert.deepEqual(await row(), { lane: "in-review", headline: "Accepted with follow-ups: Retries land with backoff" });
  assert.deepEqual(await recorded(kit, coordinatorId), [REASON]);
  assert.equal(typeof latest().acceptedAt, "number");
  assert.equal(latest().followUpId, "WEB-2");
  assert.deepEqual(kit.store.logOf(coordinatorId, ISSUE_ID).flatMap(({ event }) => (event.kind === "accepted" ? [event] : [])), [{ kind: "accepted" }]);

  const followUp = kit.store.issue(coordinatorId, issueIdSchema.parse("WEB-2")) ?? assert.fail("no follow-up");
  assert.deepEqual([followUp.kind, followUp.rest, followUp.parentId, followUp.dependsOn, followUp.doneCriteria], ["build", "backlog", null, ["WEB-1"], []]);
  assert.match(followUp.description, /^A review finding left unfixed when WEB-1 was accepted as it is\./);
  assert.match(followUp.brief ?? "", /- Round 1: `src\/retry\.ts:42` \(must-fix\): The backoff never caps\.\n {2}The verifier: Anchored, as it breaks a requirement the issue's brief states explicitly\./);

  await call("agent_stop", { agent: "a1" });
  assert.deepEqual(await row(), { lane: "in-review", headline: "Accepted with follow-ups: Retries land with backoff" }, "stopped as the result says, it stays In review");
  assert.ok(!kit.store.unannounced(coordinatorId).some(({ event }) => event.kind === "returned-to-todo"), "nothing returned to Todo");
  assert.deepEqual(await update({ status: "in-review", decision: REASON }), { refused: true, text: "WEB-1's latest verdict was accepted already, so nothing changed." });
  assert.deepEqual(await update({ status: "done" }), {
    refused: true,
    text: "WEB-1 is In review (Accepted with follow-ups: Retries land with backoff): it was accepted as it is, so it stays In review, its pull request watched and what depends on it blocked, until that pull request merges, which makes it Done. Wait for the merge; it is never marked Done before.",
  });
  assert.deepEqual(await row(), { lane: "in-review", headline: "Accepted with follow-ups: Retries land with backoff" }, "not closed by the refused Done");
  assert.equal(kit.store.issue(coordinatorId, ISSUE_ID)?.closed, null);
});

test("while an accept stands, agent_start on a new branch is refused naming why, and one continuing in its last agent's environment goes", async () => {
  const { call, update } = await failedOnce();
  await call("agent_stop", { agent: "a1" });
  assert.equal((await update({ status: "in-review", decision: REASON })).refused, false);
  const fresh = await call("agent_start", { issue: "WEB-1", from: "default" });
  assert.ok(isRefusal(fresh));
  assert.equal(
    textOf(fresh),
    "agent_start is refused: Nothing changed. WEB-1 was accepted as it is and waits In review for its pull request to merge, so an agent starts on it only in its last agent's environment, on its pull request's branch: on a new branch, that pull request would be left behind and its merge wouldn't make WEB-1 Done. Start one with no from or placement.",
  );
  const joined = await call("agent_start", { issue: "WEB-1" });
  assert.ok(!isRefusal(joined), textOf(joined));
  assert.match(textOf(joined), /^Started a2 on WEB-1 as @thread:\w+ in a1's worktree/);
});

test("an accept is refused leading with the reason when a criterion failed, when CI failed on the checked commit as its pull request was last read, and when the latest verdict didn't fail", async () => {
  const criterion = await failedOnce("criterion");
  assert.deepEqual(await criterion.update({ status: "in-review", decision: REASON }), {
    refused: true,
    text: "WEB-1's latest verdict failed on more than review findings (1 of 1 criteria didn't pass), so it can't be accepted as it is: only a failure on review findings alone can. Message its agent with agent_message, stop it and start a fresh agent on the issue with agent_start, or ask the user.",
  });

  const ci = await failedOnce();
  const branch = ci.kit.thread(ci.agentThreadId).environmentBranchName ?? assert.fail("no branch");
  ci.kit.github.prs.set(branch, { number: 41, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: "FAILURE", failed: ["test"] });
  ci.kit.clock.now += 6 * 60_000;
  await ci.kit.tick();
  assert.deepEqual(await ci.update({ status: "in-review", decision: REASON }), {
    refused: true,
    text: "CI failed on #41 at 0123456, the commit WEB-1's latest verdict checked, so it can't be accepted as it is. Message its agent with agent_message, stop it and start a fresh agent on the issue with agent_start, or ask the user.",
  });
  assert.equal(ci.latest().acceptedAt, null);

  const { kit, threadId, coordinatorId, update } = await managing();
  const { agentThreadId } = await startedAgent(kit, threadId);
  await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  await settled();
  assert.deepEqual(await update({ status: "in-review", decision: REASON }), {
    refused: true,
    text: "WEB-1's latest done handoff is still being checked, so there is no failed verdict to accept yet. Wait for its verdict, which crew_catch_up brings you.",
  });
  const verdict = kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a1"))?.check?.verdict;
  await kit.call("issue_verdict", { criteria: [{ criterion: 1, result: "pass", evidence: "# pass" }], findings: [] }, verdict?.state === "running" ? verdict.verifierThreadId : assert.fail(`the verdict is ${verdict?.state}`));
  await settled();
  assert.deepEqual(await update({ status: "in-review", decision: REASON }), { refused: true, text: "WEB-1's latest verdict didn't fail (it passed), so there is no failure on review findings to accept." });
  assert.deepEqual(kit.store.issues(coordinatorId).map(({ id }) => id), ["WEB-1"], "no follow-up filed");
});

test("an accept succeeds while the agent's thread works on its fix round, and after its agent ended; it is refused when a newer handoff replaced the check while the views were read", async () => {
  const working = await failedOnce();
  await working.kit.startTurn(working.agentThreadId);
  assert.equal(working.kit.thread(working.agentThreadId).status, "active");
  assert.equal((await working.update({ status: "in-review", decision: REASON })).refused, false);
  assert.deepEqual(await working.row(), { lane: "in-review", headline: "Accepted with follow-ups: Retries land with backoff" }, "In review while its thread still works");
  await working.call("agent_stop", { agent: "a1" });
  assert.deepEqual(await working.row(), { lane: "in-review", headline: "Accepted with follow-ups: Retries land with backoff" }, "and once it is stopped after a turn without a handoff");

  const ended = await failedOnce();
  await ended.call("agent_stop", { agent: "a1" });
  const accepted = await ended.update({ status: "in-review", decision: REASON });
  assert.equal(accepted.refused, false);
  assert.doesNotMatch(accepted.text, /still holds/, "no agent to stop");
  assert.deepEqual(await ended.row(), { lane: "in-review", headline: "Accepted with follow-ups: Retries land with backoff" });

  const raced = await failedOnce();
  const stale = raced.latest().id;
  const { started, release } = await holdingThreadLists(raced.kit, 1, () => raced.update({ status: "in-review", decision: REASON }));
  newerHandoff(raced.kit.store, raced.coordinatorId);
  release();
  const refused = await started;
  assert.equal(refused.refused, true);
  assert.match(refused.text, /^WEB-1's latest done handoff is still being checked/, "read again, the views show the newer handoff");
  const direct = raced.kit.store.updateIssue(raced.coordinatorId, ISSUE_ID, { decision: { text: REASON, at: 9_000 }, accept: stale }, { requireUnheld: false, closes: new Map(), at: 9_000 });
  assert.deepEqual(direct, { refused: "A newer handoff of WEB-1 replaced the verdict you accepted before the accept was written, so nothing changed. Read WEB-1 with issue_read, and decide once its new verdict comes." }, "the write itself refuses a check that is no longer the latest");
  assert.equal(raced.kit.store.issues(raced.coordinatorId).length, 1, "no follow-up filed");
  assert.deepEqual(await recorded(raced.kit, raced.coordinatorId), [], "no decision recorded");
});

/** a1 hands off done again on WEB-1, written straight to the store, as a handoff that lands while the manager's views are read. */
function newerHandoff(store: Awaited<ReturnType<typeof managing>>["kit"]["store"], coordinatorId: CoordinatorId): void {
  const handoff = { id: handoffIdSchema.parse(randomUUID()), coordinatorId, issueId: ISSUE_ID, agentId: agentIdSchema.parse("a1"), at: Date.now(), turnSeq: 99, ...REPORT };
  store.insertHandoff({ ...handoff, status: "done", delivery: { kind: "commit", headSha: HEAD, prUrl: null } }, { kind: "read", branch: null, checkout: { headSha: HEAD, changedFiles: [], changedFileCount: 0 } });
}

test("an accept is refused while the plugin's question at the issue's cap is open, naming it, and succeeds once the user answers", async () => {
  const { kit, threadId, coordinatorId, update, call } = await managing();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await toCap(kit, threadId, coordinatorId, issue, agentThreadId, "review");
  const [question] = kit.store.decisions(coordinatorId);
  assert.equal(question?.cap, 3);
  assert.match(textOf(await call("crew_catch_up", {})), /Until the user answers d1, agent_start, agent_message and an accept of WEB-1 are refused\. .* If they choose to merge it as is: It failed on review findings alone, so you may accept it as it is/);
  const refused = await update({ status: "in-review", decision: REASON });
  assert.equal(refused.refused, true);
  assert.match(refused.text, /^WEB-1 failed verification 3 times, so the plugin asked the user \(d1\), and until they answer, accepting it is theirs to decide there\. Once they answer, accept it if that is their call\. Wait for their answer/);

  await kit.rpc.answerDecision({ coordinatorId, decisionId: question.id, answer: "Merge as is, file follow-ups" });
  assert.equal((await update({ status: "in-review", decision: "The user chose to take it as it is (d1)." })).refused, false);
  assert.match(textOf(await call("issue_read", { id: "WEB-1" })), /In review: Accepted with follow-ups: Retries land with backoff/);
});

test("a canceled issue is refused an accept, and once reopened as the refusal says, the accept goes through", async () => {
  const { update, call } = await failedOnce();
  await call("agent_stop", { agent: "a1" });
  assert.deepEqual(await update({ status: "canceled" }), { refused: false, text: "Updated WEB-1." });
  const refused = await update({ status: "in-review", decision: REASON });
  assert.equal(refused.refused, true);
  assert.match(refused.text, /^WEB-1 is Canceled \(Canceled\), so it can't be accepted\. Reopen it with status "todo" first if its work is wanted, then accept it\.$/);
  assert.equal((await update({ status: "todo" })).refused, false);
  assert.equal((await update({ status: "in-review", decision: REASON })).refused, false);
});

test("a failure's update read after a newer handoff, or after the cap question opened, offers no accept: it says what superseded it", async () => {
  const pending = await failedOnce();
  await pending.kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, pending.agentThreadId);
  await pending.kit.idle(pending.agentThreadId, "Handed off.");
  await settled();
  const afterNewer = textOf(await pending.call("crew_catch_up", {}));
  assert.match(afterNewer, /as its automatic fix round 1\. Nothing to do yet: [^\n]* It can't be accepted as it is now: a newer handoff of WEB-1 replaced it, so decide on that one's verdict, which crew_catch_up brings you\./);
  assert.doesNotMatch(afterNewer, /so you may accept it as it is/);

  const { kit, threadId, coordinatorId, call } = await managing();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await toCap(kit, threadId, coordinatorId, issue, agentThreadId, "review");
  const capped = textOf(await call("crew_catch_up", {}));
  assert.equal(capped.match(/It can't be accepted as it is now: a newer handoff of WEB-1 replaced it/g)?.length, 1, "the first failure, sent back and replaced since");
  assert.match(capped, /Nothing went back to an agent: the plugin's question at WEB-1's cap \(d1\) is still open\. Until the user answers d1, agent_start, agent_message and an accept of WEB-1 are refused\./, "the second failure, read under the lock, offers only the lock's moves");
  assert.equal(capped.match(/so you may accept it as it is/g)?.length, 1, "only once the user answers the question the third failure asked");
  assert.match(capped, /If they choose to merge it as is: It failed on review findings alone, so you may accept it as it is/);
});

test("catch-up offers the accept after a failure on review findings alone, sent back to its agent or reaching the manager, and not after a criterion's", async () => {
  const offer = /It failed on review findings alone, so you may accept it as it is: issue_update \{ id: "WEB-1", status: "in-review", decision: "<why>" \} puts it In review until its pull request merges, and files the findings it leaves, its unfixed must-fixes among them, as a follow-up\./;
  const review = await failedOnce();
  const sentBack = textOf(await review.call("crew_catch_up", {}));
  assert.match(sentBack, /findings sent back to it\n\n[^\n]* as its automatic fix round 1\. Nothing to do yet: [^\n]* Or, to take it as it is instead: It failed on review findings alone, so you may accept it as it is: [^\n]* Then stop a1 with agent_stop, as a done handoff of its would replace the accepted work\./, "its first failure, sent back to its agent");
  await failsVerification(review.kit, review.coordinatorId, review.agentThreadId, "review");
  assert.match(textOf(await review.call("crew_catch_up", {})), offer);

  const criterion = await failedOnce("criterion");
  assert.doesNotMatch(textOf(await criterion.call("crew_catch_up", {})), /failed on review findings alone/);
  await failsVerification(criterion.kit, criterion.coordinatorId, criterion.agentThreadId);
  assert.doesNotMatch(textOf(await criterion.call("crew_catch_up", {})), /failed on review findings alone/);
});

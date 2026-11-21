import assert from "node:assert/strict";
import { test } from "node:test";
import { laneOf } from "../../model/board/board-groups.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { bbHttpError, coordinating, HEAD, isRefusal, ISSUE, settled, startedAgent, textOf, threadIn } from "../test-harness.ts";

const RETRIES = { ...ISSUE, brief: "Retry failed webhook deliveries with backoff.", doneCriteria: ["npm test passes", "a failed delivery is retried 3 times"] };
const REPORT = { summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [] };

/** A regional manager with RETRIES filed as i1, its thread idle so a doorbell starts a turn. */
async function filed(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  await kit.call("issue_create", RETRIES, threadId);
  kit.thread(threadId).status = "idle";
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  const rows = async () => (await kit.rpc.board({ coordinatorId })).issues.map((issue) => [issue.id, laneOf(issue), issue.headline]);
  const start = async (input: object = {}) => kit.call("agent_start", { issue: "i1", ...input }, threadId);
  return { kit, threadId, coordinatorId, doorbells, rows, start };
}

test("agent_start starts a child of the regional manager in a fresh worktree, unreported to it, links it, and its issue is In progress", async () => {
  const { kit, threadId, rows, start } = await filed();
  const result = textOf(await start());
  assert.match(result, /^Started a1 on i1 as @thread:\w+, on claude-code opus \(high\), your own provider, model and reasoning level\./);

  const { spawnedWith } = kit.thread(threadIn(result));
  assert.equal(spawnedWith.parentThreadId, threadId);
  assert.equal(spawnedWith.lifecycleOwnerThreadId, threadId);
  assert.equal(spawnedWith.parentNotifications, "off");
  assert.equal(spawnedWith.title, "Add retries");
  assert.deepEqual(spawnedWith.environment, { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
  assert.deepEqual(await rows(), [["i1", "in-progress", "Working"]]);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### In progress \(1\)\n- i1 "Add retries" \(Build; a1, @thread:\w+, on branch `bb\/\w+`\): Working/);
});

test("an agent's first message holds the description above the brief, every done-criterion, and CREW.md and MEMORY.md whole", async () => {
  const { kit, coordinatorId, start } = await filed();
  const memory = kit.memory.of(coordinatorId);
  const crewMd = memoryFileSchema.parse("CREW.md");
  const background = "Background the agent should know.\n".repeat(1_000);
  memory.write(crewMd, `# Crew rules\n\nOpen a draft PR for every change.\n\n${background}\nNever push to main.\n`, memory.read(crewMd).text?.version ?? null);

  const prompt = kit.thread(threadIn(textOf(await start()))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /^# i1: Add retries\n\nYou are agent a1, working on issue i1\./);
  assert.match(prompt, /## What it is about\n\nFailed webhook deliveries are lost\.\n\n## Brief\n\nRetry failed webhook deliveries with backoff\./);
  assert.match(prompt, /## Done when\n\nEvery one of these holds, each checked by running something:\n\n1\. npm test passes\n2\. a failed delivery is retried 3 times/);
  assert.match(prompt, /## CREW\.md[^\n]*\n\n### Crew rules\n\nOpen a draft PR for every change\./);
  assert.ok(prompt.indexOf("Never push to main.") > prompt.indexOf("### Crew rules") + 20_000, "the last CREW.md rule is missing or not past 20,000 characters");
  assert.match(prompt, /## MEMORY\.md[^\n]*\n\n[^\n]*\n\n### Memory\n\nThe index of this memory/);
});

test("an agent's first message sets a memory file's title, its first line, under its own section, and the rest of the file as it is up to its trailing whitespace", async () => {
  const { kit, threadId, coordinatorId, start } = await filed();
  const memory = kit.memory.of(coordinatorId);
  const crewMd = memoryFileSchema.parse("CREW.md");
  const rest = ["## Git", "", "````md", "# in a fence", "````", "", "<pre>", "# a shell comment", "</pre>", "", "# A later heading", "", "##### Deep"].join("\n");
  const written = `# Crew rules\n\n${rest}\n`;
  memory.write(crewMd, written, memory.read(crewMd).text?.version ?? null);

  const prompt = kit.thread(threadIn(textOf(await start()))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.ok(prompt.includes(`## CREW.md: the rules every agent follows\n\n### Crew rules\n\n${rest}\n\n## MEMORY.md`), "CREW.md's title wasn't set under its section, or a line after it changed");
  assert.equal(memory.read(crewMd).text?.content, written);
  assert.ok(textOf(await kit.call("crew_memory_read", { file: "CREW.md" }, threadId)).includes(written.trim()), "crew_memory_read no longer returns CREW.md as written");
});

test("an agent's first message leaves a memory file whose first line isn't a heading as it is", async () => {
  const { kit, coordinatorId, start } = await filed();
  const memory = kit.memory.of(coordinatorId);
  const crewMd = memoryFileSchema.parse("CREW.md");
  const crewRules = ["Crew rules", "==========", "", "# Rules"].join("\n");
  memory.write(crewMd, crewRules, memory.read(crewMd).text?.version ?? null);

  const prompt = kit.thread(threadIn(textOf(await start()))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.ok(prompt.includes(`## CREW.md: the rules every agent follows\n\n${crewRules}\n\n## MEMORY.md`), "CREW.md changed on its way into the first message");
});

test("an agent's first message keeps a memory file's indented first line as it is: indented code, not a heading", async () => {
  for (const indent of ["    ", "\t"]) {
    const { kit, coordinatorId, start } = await filed();
    const memory = kit.memory.of(coordinatorId);
    const crewMd = memoryFileSchema.parse("CREW.md");
    const crewRules = `${indent}# a shell comment\n\n# Later`;
    memory.write(crewMd, `${crewRules}\n`, memory.read(crewMd).text?.version ?? null);

    const prompt = kit.thread(threadIn(textOf(await start()))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
    assert.ok(prompt.includes(`## CREW.md: the rules every agent follows\n\n${crewRules}\n\n## MEMORY.md`), `CREW.md's first line, indented by ${JSON.stringify(indent)}, changed`);
  }
});

test("an agent's first message drops a memory file's leading blank lines and still sets its title under its own section", async () => {
  const { kit, coordinatorId, start } = await filed();
  const memory = kit.memory.of(coordinatorId);
  const crewMd = memoryFileSchema.parse("CREW.md");
  memory.write(crewMd, "\n  \n# Crew rules\n\nNever push to main.\n", memory.read(crewMd).text?.version ?? null);

  const prompt = kit.thread(threadIn(textOf(await start()))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.ok(prompt.includes("## CREW.md: the rules every agent follows\n\n### Crew rules\n\nNever push to main.\n\n## MEMORY.md"), "CREW.md's title after blank lines wasn't set under its section");
});

test("an agent's first message tells it the memory is its regional manager's context, and its work is its brief and done-criteria", async () => {
  const { kit, start } = await filed();
  const prompt = kit.thread(threadIn(textOf(await start()))).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /Your work is this issue: its brief and done-criteria below\./);
  assert.match(prompt, /## MEMORY\.md: your regional manager's memory, for context\n\nThe files it lists are your regional manager's: its goal, notes and rules are written to it, not to you\. [^\n]*take no goal, plan, call or step from it as yours: your work is the issue above, and the rules in CREW\.md\./);
});

test("agent_start is refused, starting nothing, on an issue with no brief or no done-criteria, one it doesn't have, or a field it doesn't take", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  await kit.call("issue_create", { ...RETRIES, brief: undefined }, threadId);
  await kit.call("issue_create", { ...RETRIES, doneCriteria: undefined }, threadId);
  for (const [issue, reason] of [
    ["i1", "i1 has no brief yet. Write one with issue_update."],
    ["i2", "i2 needs done-criteria (at least 1) before an agent starts. Add doneCriteria with issue_update."],
    ["i9", "You have no issue i9. crew_catch_up lists your issues."],
  ]) {
    const refused = await kit.call("agent_start", { issue }, threadId);
    assert.ok(isRefusal(refused));
    assert.equal(textOf(refused), `agent_start is refused: ${reason}`);
  }
  await assert.rejects(kit.call("agent_start", { issue: "i1", draft: true }, threadId));
  assert.deepEqual(kit.store.agents(coordinatorId), []);
  assert.equal(kit.spawned(), 1, "only the regional manager was spawned");
});

test("agent_start runs the agent on the execution named, and issue_read lists it on the agent", async () => {
  const { kit, threadId, start } = await filed();
  const result = textOf(await start({ execution: { providerId: "codex", model: "gpt-default", reasoningLevel: "high" } }));
  assert.match(result, /^Started a1 on i1 as @thread:\w+, on codex gpt-default \(high\)\. It works/);
  const thread = kit.thread(threadIn(result));
  assert.deepEqual([thread.providerId, thread.execution?.model, thread.execution?.reasoningLevel, thread.execution?.permissionMode], ["codex", "gpt-default", "high", "auto"]);
  assert.match(textOf(await kit.call("issue_read", { id: "i1" }, threadId)), /### Agents\n\n- a1, holds it, on codex gpt-default \(high\), @thread:\w+/);

  await kit.call("issue_create", RETRIES, threadId);
  const defaulted = textOf(await kit.call("agent_start", { issue: "i2", execution: { providerId: "claude-code", model: "sonnet" } }, threadId));
  assert.match(defaulted, /on claude-code sonnet \(medium\)\./, "a reasoning level left out is the model's default in bb's catalog");
});

test("an execution bb can't run where the agent would work is refused before anything starts, naming what it can run", async () => {
  const { kit, coordinatorId, start } = await filed();
  kit.providers.list = kit.providers.list.map((provider) => (provider.id === "codex" ? { ...provider, available: false } : provider));
  // As bb lists a provider whose executable is missing: available, with models it can't load.
  kit.providers.list.push({ id: "pi", available: true, models: null });
  const where = "agent_start is refused: Nothing changed. Where the agent would run (a fresh worktree on your machine):";
  for (const [execution, refusal] of [
    [{ providerId: "gemini", model: "pro" }, "bb can't run gemini there. bb can run: claude-code."],
    [{ providerId: "codex", model: "gpt-default" }, "bb can't run codex there. bb can run: claude-code."],
    [{ providerId: "pi", model: "x" }, "bb can't load pi's models there. bb can run: claude-code."],
    [{ providerId: "claude-code", model: "gpt-9" }, "claude-code has no model gpt-9 there. Its models: opus (default), sonnet. bb can run: claude-code."],
  ] as const) {
    const refused = await start({ execution });
    assert.ok(isRefusal(refused));
    assert.equal(textOf(refused), `${where} ${refusal}`);
  }
  assert.deepEqual(kit.store.agents(coordinatorId), []);
  assert.equal(kit.spawned(), 1, "only the regional manager was spawned");
});

test("an agent on its issue's verifier is refused, named or inherited, offering the other change", async () => {
  const { kit, threadId, coordinatorId, start } = await filed();
  await kit.call("issue_update", { id: "i1", verifier: { providerId: "codex", model: "gpt-default" } }, threadId);
  const named = await start({ execution: { providerId: "codex", model: "gpt-default" } });
  assert.ok(isRefusal(named));
  assert.equal(textOf(named), "agent_start is refused: i1's verifier is codex gpt-default (low), so an agent on it couldn't be checked by another model. Name another execution, or change i1's verifier with issue_update.");

  Object.assign(kit.thread(threadId), { providerId: "codex", execution: { model: "gpt-default", reasoningLevel: "low", serviceTier: "default", permissionMode: "auto" } });
  const inherited = await start();
  assert.ok(isRefusal(inherited));
  assert.match(textOf(inherited), /^agent_start is refused: i1's verifier is codex gpt-default \(low\), so an agent on your own model couldn't be checked by another model\./);
  assert.deepEqual(kit.store.agents(coordinatorId), []);
});

test("a provider placement spawns as bb's own CLI would, and a sandbox agent gets a new branch from the project's default one", async () => {
  const { kit, threadId } = await coordinating();
  const environmentOf = async (placement: object) => kit.thread((await startedAgent(kit, threadId, RETRIES, { placement })).agentThreadId).spawnedWith.environment;
  const ownBranch = { branch: { kind: "new", baseBranch: "main" } };
  assert.deepEqual(await environmentOf({ kind: "provider", environmentProviderId: "boat-sandbox", machineInputs: { preset: "small" } }), {
    type: "provider",
    environmentProviderId: "boat-sandbox",
    inputs: ownBranch,
    machine: { type: "new", machineProviderId: "boat-sandbox", inputs: { preset: "small" } },
  });
  assert.deepEqual(await environmentOf({ kind: "provider", environmentProviderId: "boat-sandbox" }), {
    type: "provider",
    environmentProviderId: "boat-sandbox",
    inputs: ownBranch,
    machine: { type: "new", machineProviderId: "boat-sandbox", inputs: {} },
  });
  assert.deepEqual(await environmentOf({ kind: "provider", environmentProviderId: "project-checkout" }), { type: "provider", environmentProviderId: "project-checkout", inputs: {} }, "the user's own checkout keeps its branch");
  assert.deepEqual(await environmentOf({ kind: "provider", environmentProviderId: "personal-workspace" }), { type: "provider", environmentProviderId: "personal-workspace", inputs: null });
});

test("a sandbox agent is refused when bb records no default branch to start its branch from", async () => {
  const { kit, coordinatorId, start } = await filed();
  kit.environments.defaultBranch = null;
  const result = await start({ placement: { kind: "provider", environmentProviderId: "boat-sandbox" } });
  assert.ok(isRefusal(result));
  assert.match(textOf(result), /bb records no default branch for this project/);
  assert.deepEqual(kit.store.agents(coordinatorId), []);
});

test("a provider bb doesn't have, or machineInputs for one that makes no machine, is refused and starts nothing", async () => {
  const { kit, coordinatorId, start } = await filed();
  const unknown = await start({ placement: { kind: "provider", environmentProviderId: "boat" } });
  assert.ok(isRefusal(unknown));
  assert.match(textOf(unknown), /bb has no environment provider boat\. It has: project-checkout, personal-workspace, boat-sandbox\./);
  const machineless = await start({ placement: { kind: "provider", environmentProviderId: "project-checkout", machineInputs: { preset: "small" } } });
  assert.ok(isRefusal(machineless));
  assert.match(textOf(machineless), /project-checkout makes no machine that takes inputs, so leave out machineInputs/);
  assert.deepEqual(kit.store.agents(coordinatorId), []);
});

test("agents are numbered in the order started, per regional manager, across issues", async () => {
  const { kit, threadId } = await coordinating();
  for (const title of ["Add retries", "Dead letters"]) await kit.call("issue_create", { ...RETRIES, title }, threadId);
  assert.match(textOf(await kit.call("agent_start", { issue: "i2" }, threadId)), /^Started a1 on i2 /);
  assert.match(textOf(await kit.call("agent_start", { issue: "i1" }, threadId)), /^Started a2 on i1 /);
  const other = await kit.startManager("Retire the cron box");
  assert.match(textOf(await kit.call("issue_create", RETRIES, other.threadId)), /^Filed i1 /);
  assert.match(textOf(await kit.call("agent_start", { issue: "i1" }, other.threadId)), /^Started a1 on i1 /);
});

test("an agent whose spawn failed ends, and its issue rests in Todo with nothing told; one whose answer alone was lost is started", async () => {
  const { kit, coordinatorId, rows, doorbells, start } = await filed();
  Object.assign(kit.spawns, { created: false, answer: "lost" });
  assert.equal(textOf(await start()), "bb did not start a1's thread: socket hang up. i1 has no agent and rests in Todo: call agent_start again, or tell the user.");
  assert.equal(kit.store.agents(coordinatorId)[0]?.ended?.how, "spawn-failed");
  assert.deepEqual(await rows(), [["i1", "todo", "bb never started its agent's thread"]]);

  Object.assign(kit.spawns, { created: true, answer: "lost" });
  assert.match(textOf(await start()), /^Started a2 on i1 as @thread:\w+/);
  assert.deepEqual(await rows(), [["i1", "in-progress", "Working"]]);
  await settled();
  assert.deepEqual(doorbells(), []);
});

test("an agent whose spawn the plugin never heard the end of flags its issue until agent_stop ends it, and agent_start starts the work again", async () => {
  const { kit, threadId, coordinatorId, rows, start } = await filed();
  const unconfirmed = "No thread: bb never confirmed starting one. agent_stop ends the agent at once; then agent_start again";
  // As agent_start leaves it when the plugin stops before bb answers its spawn: inserted, never bound or ended.
  const execution = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
  kit.store.insertAgent({ coordinatorId, issueId: issueIdSchema.parse("i1"), ticket: "lost-spawn", placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution, at: 2_000 });

  assert.deepEqual(await rows(), [["i1", "needs-you", unconfirmed]]);
  assert.ok(textOf(await kit.call("crew_catch_up", {}, threadId)).includes(`### Needs you (1)\n- i1 "Add retries" (Build; a1, no thread): ${unconfirmed}`));

  assert.match(textOf(await kit.call("agent_stop", { agent: "a1" }, threadId)), /^a1 is stopped; it no longer holds i1\./);
  assert.deepEqual(await rows(), [["i1", "todo", "Its agent was stopped"]]);
  assert.match(textOf(await start()), /^Started a2 on i1 /);
});

test("an agent's first message and rules name its regional manager's thread, the one bb heads agent_message with, as its next instruction, which a done handoff waits for too", async () => {
  const { kit, threadId, start } = await filed();
  const agentThreadId = threadIn(textOf(await start()));

  const prompt = kit.thread(agentThreadId).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, new RegExp(`^# i1: Add retries\\n\\nYou are agent a1, working on issue i1\\. Your regional manager, your parent thread ${threadId}, started you with this brief\\.`));
  assert.ok(prompt.includes(`\n\nA message headed \`[bb message from thread:${threadId}]\` is from your regional manager: its next instruction to you. Follow it, after a handoff too.\n\n## What it is about`), prompt);
  assert.match(kit.configurationFor(agentThreadId, {}).instructions ?? "", /Naming your regional manager's thread, which your first message names, it is your regional manager's next instruction: follow it, after a handoff too\./);
  const handedOff = textOf(await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId));
  assert.ok(handedOff.endsWith("Stop here, and change nothing in this environment until you hear back from the verifier or your regional manager."), handedOff);

  await kit.call("agent_message", { agent: "a1", text: "Also log each retry." }, threadId);
  const toAgent = kit.sent().filter((args) => args.threadId === agentThreadId);
  assert.deepEqual(toAgent.map(({ senderThreadId, input }) => [senderThreadId, input]), [[threadId, [{ type: "text", text: "Your regional manager's next instruction, on i1:\n\nAlso log each retry.", mentions: [] }]]]);
});

test("agent_message reaches the agent as a message from the regional manager's thread", async () => {
  const { kit, threadId, start } = await filed();
  const agentThreadId = threadIn(textOf(await start()));

  assert.equal(textOf(await kit.call("agent_message", { agent: "a1", text: "Use exponential backoff." }, threadId)), "Sent to a1.");
  assert.deepEqual(kit.sent().map(({ threadId: to, senderThreadId, mode, input }) => ({ to, senderThreadId, mode, input })), [
    { to: agentThreadId, senderThreadId: threadId, mode: "auto", input: [{ type: "text", text: "Your regional manager's next instruction, on i1:\n\nUse exponential backoff.", mentions: [] }] },
  ]);
});

test("an agent id the regional manager has none by is refused, and an agent can't be reached from another regional manager", async () => {
  const { kit, threadId, start } = await filed();
  await start();
  const other = await kit.startManager("Retire the cron box");

  for (const caller of [threadId, other.threadId]) {
    const agent = caller === threadId ? "a2" : "a1";
    const result = await kit.call("agent_message", { agent, text: "Hello" }, caller);
    assert.ok(isRefusal(result));
    assert.match(textOf(result), new RegExp(`You have no agent ${agent}`));
  }
  assert.deepEqual(kit.sent(), []);
});

test("the board puts a running agent's issue In progress, one waiting on an approval under Needs you, and a stopped one back in Todo", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const ids = [];
  for (const title of ["Running", "Asking", "Stopped"]) ids.push((await startedAgent(kit, threadId, { ...RETRIES, title })).agentThreadId);
  kit.thread(ids[1] ?? "").hasPendingInteraction = true;
  assert.equal(textOf(await kit.call("agent_stop", { agent: "a3" }, threadId)), "a3 is stopped; it no longer holds i3. crew_catch_up shows where i3 stands now.");

  const { issues } = await kit.rpc.board({ coordinatorId });
  assert.deepEqual(issues.map((issue) => [issue.id, laneOf(issue), issue.agent?.id, issue.agent?.threadId]), [
    ["i1", "in-progress", "a1", ids[0]],
    ["i2", "needs-you", "a2", ids[1]],
    ["i3", "todo", "a3", ids[2]],
  ]);
  assert.deepEqual(Object.keys(issues[0] ?? {}).sort(), ["agent", "blockedBy", "headline", "id", "kind", "needsYou", "parentId", "pr", "status", "subIssues", "title"], "a row sends only what the board shows, its parent and sub-issues for issue 08's board part");
});

test("crew_catch_up shows the updates, then the board by lane with each issue's agent, then the memory", async () => {
  const { kit, threadId, start } = await filed();
  const agentThreadId = threadIn(textOf(await start()));
  kit.thread(agentThreadId).status = "idle";
  await kit.call("issue_create", { ...RETRIES, title: "Dead letters", status: "backlog" }, threadId);

  const text = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(text, /^## Updates\n\nNothing new since your last catch-up\.\n\n## Board/);
  assert.ok(
    text.includes(
      `## Board\n\n### In progress (1)\n- i1 "Add retries" (Build; a1, @thread:${agentThreadId}, on branch \`bb/${agentThreadId}\`): Its turn ended without a handoff\n\n### Backlog (1)\n- i2 "Dead letters" (Build; no agent): Not planned`,
    ),
  );
  assert.ok(text.indexOf("## Board") < text.indexOf("## MEMORY.md"));
});

test("agent_stop ends the agent only once bb no longer runs its thread", async () => {
  const { kit, threadId, coordinatorId } = await filed({ stops: "stopping" });
  await kit.call("agent_start", { issue: "i1" }, threadId);

  assert.match(textOf(await kit.call("agent_stop", { agent: "a1" }, threadId)), /still stopping, so it still holds i1/);
  assert.equal(kit.store.agents(coordinatorId)[0]?.ended, null);
});

test("agent_stop stops an idle agent's thread too, so a background command it left running never wakes it", async () => {
  const { kit, threadId } = await filed();
  const agentThreadId = threadIn(textOf(await kit.call("agent_start", { issue: "i1" }, threadId)));
  kit.leavesBackground(agentThreadId);
  await kit.idle(agentThreadId, "Waiting on the sleep in the background.");
  const turns = kit.thread(agentThreadId).turns.length;

  assert.match(textOf(await kit.call("agent_stop", { agent: "a1" }, threadId)), /^a1 is stopped; it no longer holds i1\./);
  await kit.backgroundFinishes(agentThreadId);

  assert.deepEqual([kit.thread(agentThreadId).status, kit.thread(agentThreadId).turns.length], ["idle", turns], "a1 never woke");
});

test("a stop whose answer bb lost is refused as unconfirmed, not as a stop that didn't happen, and agent_stop again ends the agent", async () => {
  const { kit, threadId, coordinatorId } = await filed();
  const agentThreadId = threadIn(textOf(await kit.call("agent_start", { issue: "i1" }, threadId)));
  kit.stopRequests.lost = new Error("socket hang up");

  const refused = textOf(await kit.call("agent_stop", { agent: "a1" }, threadId));

  assert.equal(kit.thread(agentThreadId).status, "idle", "the stop landed");
  assert.equal(refused, "Asked a1 to stop, but its thread couldn't be confirmed stopped: bb answered socket hang up, so it still holds i1. Call agent_stop again shortly.");
  assert.equal(kit.store.agents(coordinatorId)[0]?.ended, null);
  kit.stopRequests.lost = null;
  assert.match(textOf(await kit.call("agent_stop", { agent: "a1" }, threadId)), /^a1 is stopped; it no longer holds i1\./);
});

test("an agent that ends its turn by itself while agent_stop waits on bb is reported with its last answer, whether the stop then succeeds or fails", async () => {
  for (const failure of [null, bbHttpError(502, "bad_gateway", "Bad gateway")]) {
    const { kit, threadId, coordinatorId } = await filed();
    const agentThreadId = threadIn(textOf(await kit.call("agent_start", { issue: "i1" }, threadId)));
    let answer = (): void => assert.fail("bb never received the stop");
    kit.stopRequests.pending = new Promise((resolve) => (answer = resolve));
    kit.stopRequests.failure = failure;
    const stopping = kit.call("agent_stop", { agent: "a1" }, threadId);
    await settled();
    await kit.idle(agentThreadId, "I need the staging key.");
    answer();

    if (failure === null) assert.match(textOf(await stopping), /^a1 is stopped; it no longer holds i1\./);
    else {
      assert.match(textOf(await stopping), /^Asked a1 to stop, but its thread couldn't be confirmed stopped: bb answered HTTP 502: Bad gateway, so it still holds i1\./);
      assert.equal(kit.store.agents(coordinatorId)[0]?.ended, null);
    }
    assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### i1 "Add retries" \(a1\) ended its turn without a handoff\n\nAt [^\n]+ Its last answer, in its own words:\n\nI need the staging key\./);
  }
});

test("agent_stop keeps the thread unless asked to archive it; either way the issue returns to Todo and the regional manager is told", async () => {
  const { kit, threadId, rows, doorbells } = await filed();
  const kept = threadIn(textOf(await kit.call("agent_start", { issue: "i1" }, threadId)));
  await kit.call("issue_create", { ...RETRIES, title: "Dead letters" }, threadId);
  const archived = threadIn(textOf(await kit.call("agent_start", { issue: "i2" }, threadId)));

  await kit.call("agent_stop", { agent: "a1" }, threadId);
  assert.equal(textOf(await kit.call("agent_stop", { agent: "a2", archive: true }, threadId)), "a2 is stopped and its thread archived; it no longer holds i2. crew_catch_up shows where i2 stands now.");
  await settled();
  assert.equal(kit.thread(kept).archivedAt, null);
  assert.notEqual(kit.thread(archived).archivedAt, null);
  assert.deepEqual(await rows(), [
    ["i1", "todo", "Its agent was stopped"],
    ["i2", "todo", "Its agent was stopped"],
  ]);
assert.equal(doorbells()[0], '[Regional Manager] 1 update. Call crew_catch_up to read it in full.\n- i1 "Add retries" (a1) ended its turn without a handoff');
  // why each agent ends its turn as well: bb announces the stopped turn idle, and can't say the stop ended it.
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.deepEqual(caughtUp.match(/^### .+$/gm)?.slice(0, 4), [
    '### i1 "Add retries" (a1) ended its turn without a handoff',
    '### i1 "Add retries" (a1) returned to Todo',
    '### i2 "Dead letters" (a2) ended its turn without a handoff',
    '### i2 "Dead letters" (a2) returned to Todo',
  ]);
  assert.match(caughtUp, /### i1 "Add retries" \(a1\) returned to Todo\n\nAt [^\n]+ a1 was stopped before its work reached Verifying, In review or Done, so i1 rests in Todo with no agent\./);
  assert.equal(textOf(await kit.call("agent_message", { agent: "a1", text: "More" }, threadId)), "a1 was stopped, so it takes no more messages. Start a new agent on i1 with agent_start.");
  assert.equal(textOf(await kit.call("agent_stop", { agent: "a1" }, threadId)), "a1 had already ended (stopped); nothing changed.");
});

test("an issue opened on the board links each ended agent's thread while bb has it, archived or not, and none once it is deleted", async () => {
  const { kit, threadId, coordinatorId, start } = await filed();
  const stopped = threadIn(textOf(await start()));
  await kit.call("agent_stop", { agent: "a1" }, threadId);
  const archived = threadIn(textOf(await start()));
  await kit.call("agent_stop", { agent: "a2", archive: true }, threadId);
  await settled();
  const heldBy = async () => (await kit.rpc.issue({ coordinatorId, issueId: issueIdSchema.parse("i1") })).record.map(({ agent }) => agent);
  assert.deepEqual(await heldBy(), [
    { id: "a1", threadId: stopped, ended: "stopped" },
    { id: "a2", threadId: archived, ended: "stopped" },
  ]);

  for (const id of [stopped, archived]) kit.thread(id).deletedAt = Date.now();
  assert.deepEqual(await heldBy(), [
    { id: "a1", threadId: null, ended: "stopped" },
    { id: "a2", threadId: null, ended: "stopped" },
  ]);
});

test("work that reached In review survives its agent's end, and a stopped agent's handoff is refused", async () => {
  const { kit, threadId, rows, doorbells, start } = await filed({ verify: false });
  const agentThreadId = threadIn(textOf(await start()));
  await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  assert.deepEqual(await rows(), [["i1", "in-review", "Unverified: Retries land with backoff"]]);
  await settled();
  const told = doorbells().length;

  await kit.call("agent_stop", { agent: "a1" }, threadId);
  await settled();
  assert.deepEqual(await rows(), [["i1", "in-review", "Unverified: Retries land with backoff"]]);
  assert.equal(doorbells().length, told, "nothing returned to Todo");

  const stale = await kit.call("agent_handoff", { ...REPORT, status: "blocked" }, agentThreadId);
  assert.ok(isRefusal(stale));
  assert.equal(textOf(stale), "agent_handoff is refused: you no longer hold i1 (you were stopped), so nothing reads a handoff from you. Stop here.");
});

test("issue_read returns the issue's status, plan, agents and its agent's latest answer", async () => {
  const { kit, threadId, start } = await filed();
  await start();

  const text = textOf(await kit.call("issue_read", { id: "i1" }, threadId));
  assert.match(text, /^## i1: Add retries\n\nBuild\. In progress: Working\./);
  assert.match(text, /### What it is about\n\nFailed webhook deliveries are lost\./);
  assert.match(text, /### Done when\n\n1\. npm test passes\n2\. a failed delivery is retried 3 times/);
  assert.match(text, /### Verifier\n\nNone named: the plugin picks one independent of its agent\./);
  assert.match(text, /### Its record\n\nNo handoff yet\./);
  assert.match(text, /### Its agent's latest answer\n\nDone: npm test passes\./);
});

test("an agent thread's status change refreshes its regional manager's board, and no other's", async () => {
  const { kit, threadId, coordinatorId, start } = await filed();
  const agentThreadId = threadIn(textOf(await start()));
  const before = kit.invalidated().length;

  await kit.emit("thread.active", { thread: kit.ref(agentThreadId) });
  await kit.threadNow(agentThreadId);
  await kit.emit("thread.active", { thread: kit.ref(threadId) });
  await kit.threadNow(threadId);
  assert.deepEqual(kit.invalidated().slice(before), [`board:${coordinatorId}`, `board:${coordinatorId}`]);
});

test("an agent whose thread was archived or deleted while the plugin wasn't listening is ended by the tick, and its issue returns to Todo", async () => {
  const { kit, threadId, coordinatorId, rows, doorbells } = await filed();
  const archived = threadIn(textOf(await kit.call("agent_start", { issue: "i1" }, threadId)));
  await kit.call("issue_create", { ...RETRIES, title: "Dead letters" }, threadId);
  const deleted = threadIn(textOf(await kit.call("agent_start", { issue: "i2" }, threadId)));
  kit.thread(archived).archivedAt = 5_000;
  kit.thread(deleted).deletedAt = 5_000;

  await kit.tick();
  await settled();
  assert.deepEqual(kit.store.agents(coordinatorId).map((agent) => agent.ended?.how), ["archived", "deleted"]);
  assert.deepEqual(await rows(), [
    ["i1", "todo", "Its agent was archived"],
    ["i2", "todo", "Its agent was deleted"],
  ]);
  // why sorted: each issue's end runs in its own turn, side by side.
  assert.deepEqual(doorbells().flatMap((text) => text.split("\n").slice(1)).sort(), ['- i1 "Add retries" (a1) returned to Todo: its agent was archived', '- i2 "Dead letters" (a2) returned to Todo: its agent was deleted']);
  // why: a start reads the queues of the issue's earlier agents that bb still has, and bb no longer has a2's.
  assert.match(textOf(await kit.call("agent_start", { issue: "i2", from: "default" }, threadId)), /^Started a3 on i2/);
});

for (const first of ["agent", "manager", "neither"] as const) {
  test(`deleting a regional manager removes it and its rows, and rings nothing after, though a verifier was running (${first === "neither" ? "no event: the tick finds it" : `the ${first}'s event first`})`, async () => {
    const { kit, threadId, coordinatorId, start } = await filed();
    const agentThreadId = threadIn(textOf(await start()));
    await kit.call("crew_remind", { note: "check on i1", at: "2m" }, threadId);
    await kit.call("crew_ask_user", { question: "Ship it?", issue: "i1" }, threadId);
    await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
    await settled();
    const verdict = kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a1"))?.check?.verdict;
    if (verdict?.state !== "running") return assert.fail("no running verifier");
    const attempts = kit.sendAttempts().length;
    // As bb deletes a regional manager: its thread and every child go at once, then one thread.deleted each.
    for (const id of [threadId, agentThreadId, verdict.verifierThreadId]) kit.thread(id).deletedAt = Date.now();
    const events = first === "agent" ? [agentThreadId, threadId] : first === "manager" ? [threadId, agentThreadId] : [];
    for (const id of events) await kit.emit("thread.deleted", { thread: kit.ref(id) });
    kit.clock.now += 3 * 60_000;
    await kit.tick();
    await settled();

    assert.equal(kit.store.coordinator(coordinatorId), null);
    assert.deepEqual([kit.store.issues(coordinatorId), kit.store.agents(coordinatorId), kit.store.decisions(coordinatorId), kit.store.reminders(coordinatorId)], [[], [], [], []]);
    assert.equal(kit.store.roleOfThread(agentThreadId), null);
    assert.deepEqual(kit.sendAttempts().slice(attempts), [], "nothing is sent to any of its threads");
    assert.deepEqual(kit.warnings(), []);
    assert.ok(kit.invalidated().includes("coordinators"), "the panel lists it no more");
  });
}

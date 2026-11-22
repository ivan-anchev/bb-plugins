import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import { coordinating, HEAD, isRefusal, ISSUE, settled, textOf, threadIn, type FakePr } from "../../test-harness.ts";

const RESEARCH = { kind: "research", title: "Pick a card vault", description: "Which vault fits our PCI scope.", brief: "Compare Vault and KMS.", doneCriteria: [] };
const REPORT = "## Recommendation\n\nVault: it keeps card data inside our PCI scope.";
const FIELDS = { summary: "Vault fits our PCI scope", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
const RESEARCH_DONE = { status: "done", ...FIELDS, report: REPORT };

async function managing() {
  const { kit, threadId, coordinatorId } = await coordinating();
  const call = async (tool: string, input: object) => {
    const result = await kit.call(tool, input, threadId);
    return { refused: isRefusal(result), text: textOf(result) };
  };
  const text = async (tool: string, input: object) => (await call(tool, input)).text;
  const announced: string[] = [];
  const catchUp = async () => {
    const caughtUp = await text("crew_catch_up", {});
    for (const [, issue, by, as] of caughtUp.matchAll(/^### (WEB-\d+) "[^"]*" is unblocked: (WEB-\d+) (\w+)$/gm)) announced.push(`${issue} by ${by} ${as}`);
    return caughtUp;
  };
  const unblocked = async () => {
    await catchUp();
    return [...announced];
  };
  const board = async () => (await catchUp()).split("## Board\n\n")[1]?.split("\n\n## Decisions")[0] ?? assert.fail("no board");
  const row = async (id: string) => (await board()).split("\n").find((line) => line.startsWith(`- ${id} `)) ?? assert.fail(`no row for ${id}`);
  const readyLine = async () => (await board()).split("\n").find((line) => line.startsWith("Ready: ")) ?? assert.fail("no ready line");
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  const managerIdle = () => {
    kit.thread(threadId).status = "idle";
  };
  async function research() {
    await text("issue_create", RESEARCH);
    const agentThreadId = threadIn(await text("agent_start", { issue: "WEB-1" }));
    const report = async (input: object = RESEARCH_DONE) => {
      await kit.call("agent_handoff", input, agentThreadId);
      await kit.idle(agentThreadId, "Handed off.");
      await settled();
    };
    return { agentThreadId, report };
  }
  return { kit, threadId, coordinatorId, call, text, catchUp, board, row, readyLine, doorbells, managerIdle, unblocked, research };
}

test("an issue filed depending on another is blocked by it as filed, in issue_read and catch-up, and the other blocks it", async () => {
  const { text, row } = await managing();
  await text("issue_create", { ...ISSUE, title: "Retry budget" });
  assert.equal(await text("issue_create", { ...ISSUE, dependsOn: ["WEB-1"] }), "Filed WEB-2 (build) in Todo, blocked by WEB-1 (Todo).");

  const dependent = await text("issue_read", { id: "WEB-2" });
  assert.match(dependent, /^Build\. Todo: Not started\. Blocked by WEB-1 \(Todo\)\. Thread: no thread\.$/m);
  assert.match(dependent, /### Relations\n\nParent: none\.\nSub-issues: none\.\nDepends on: WEB-1 \(Todo\)\.\nBlocks: nothing\./);
  assert.match(await text("issue_read", { id: "WEB-1" }), /### Relations\n\nParent: none\.\nSub-issues: none\.\nDepends on: nothing\.\nBlocks: WEB-2 \(Todo\)\./);
  assert.equal(await row("WEB-2"), '- WEB-2 "Add retries" (Build; no agent): Not started; blocked by WEB-1 (Todo)');
  assert.equal(await row("WEB-1"), '- WEB-1 "Retry budget" (Build; no agent): Not started');
});

test("a dependency on no issue, on itself, or closing a cycle is refused naming it, and nothing of the change is written", async () => {
  const { kit, coordinatorId, call } = await managing();
  await call("issue_create", ISSUE);
  await call("issue_create", { ...ISSUE, dependsOn: ["WEB-1"] });
  await call("issue_create", { ...ISSUE, dependsOn: ["WEB-2"] });
  const plans = () => kit.store.issues(coordinatorId).map(({ id, title, dependsOn }) => [id, title, dependsOn]);
  const before = plans();

  assert.deepEqual(await call("issue_create", { ...ISSUE, dependsOn: ["WEB-9"] }), { refused: true, text: "No issue filed: WEB-4 can't depend on WEB-9: there is no issue WEB-9." });
  assert.deepEqual(await call("issue_update", { id: "WEB-1", dependsOn: { add: ["WEB-1"] } }), { refused: true, text: "WEB-1 can't depend on itself." });
  assert.deepEqual(await call("issue_update", { id: "WEB-1", title: "Retry budget", dependsOn: { add: ["WEB-3"] } }), { refused: true, text: "WEB-1 can't depend on WEB-3: that would close a cycle, WEB-1 → WEB-3 → WEB-2 → WEB-1." });
  assert.deepEqual(plans(), before);
});

test("an agent starts on a blocked issue, and its result says what blocks it", async () => {
  const { text } = await managing();
  await text("issue_create", { ...ISSUE, title: "Retry budget" });
  await text("issue_create", { ...ISSUE, dependsOn: ["WEB-1"] });
  const started = await text("agent_start", { issue: "WEB-2" });
  assert.match(started, /^Started a1 on WEB-2 as @thread:\w+, /);
  assert.match(started, / WEB-2 is blocked by WEB-1 \(Todo\): its agent started anyway, and has nothing of that work but what its brief names\.$/);
  assert.doesNotMatch(await text("agent_start", { issue: "WEB-1" }), /blocked/);
});

test("a research dependency's report unblocks its dependent with a wake; a message to its agent blocks it again until the next report", async () => {
  const { call, text, catchUp, row, readyLine, doorbells, managerIdle, unblocked, research } = await managing();
  const { report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  assert.match(await row("WEB-2"), /; blocked by WEB-1 \(In progress\)$/);
  assert.equal(await readyLine(), "Ready: none (in Todo, no sub-issues, and nothing they or their parent depend on is open).");

  managerIdle();
  await report();
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /\n- WEB-2 "Card vault schema" is unblocked: WEB-1 done$/);
  assert.match(await catchUp(), /### WEB-2 "Card vault schema" is unblocked: WEB-1 done\n\nAt [^\n]* WEB-1 was the last open issue blocking WEB-2, as its own dependency or its parent's\. Nothing of WEB-1 reaches WEB-2 on its own:/);
  assert.equal(await row("WEB-2"), '- WEB-2 "Card vault schema" (Build; no agent): Not started');
  assert.equal(await readyLine(), "Ready: WEB-2 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");

  await call("agent_message", { agent: "a1", text: "Add what KMS would cost." });
  assert.match(await row("WEB-2"), /; blocked by WEB-1 \(In progress\)$/);
  assert.equal(await readyLine(), "Ready: none (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
  await report({ ...RESEARCH_DONE, summary: "Vault fits; KMS costs more" });
  assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done", "WEB-2 by WEB-1 done"]);
  assert.equal(await readyLine(), "Ready: WEB-2 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
});

test("a handoff that closes nothing, or closes an issue nothing waits on, announces nothing", async () => {
  const { kit, threadId, text, unblocked, research } = await managing();
  const { report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await report({ status: "blocked", ...FIELDS, summary: "Needs a PCI contact" });
  assert.deepEqual(await unblocked(), []);

  await text("issue_create", { ...RESEARCH, title: "Pick a queue" });
  const other = threadIn(await text("agent_start", { issue: "WEB-3" }));
  await kit.call("agent_handoff", RESEARCH_DONE, other);
  await kit.idle(other, "Handed off.");
  await settled();
  assert.deepEqual(await unblocked(), []);
  assert.match(textOf(await kit.call("issue_read", { id: "WEB-2" }, threadId)), /Blocked by WEB-1 \(In progress\)\./);
});

test("a build dependency whose pull request merges unblocks its dependent once; one still blocked by another is not announced", async () => {
  const { kit, text, readyLine, doorbells, managerIdle, unblocked } = await managing();
  await text("issue_create", ISSUE);
  const builder = threadIn(await text("agent_start", { issue: "WEB-1" }));
  await text("issue_create", { ...RESEARCH, title: "Pick a queue" });
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["WEB-1"] });
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["WEB-1", "WEB-2"] });
  managerIdle();

  const branch = kit.thread(builder).environmentBranchName ?? assert.fail("no branch");
  kit.github.prs.set(branch, { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  await kit.tick();
  await settled();
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /- WEB-1 "Add retries" \(a1\) PR #41: merged\n- WEB-3 "Dead letters" is unblocked: WEB-1 done$/);
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-3 by WEB-1 done"]);
  assert.equal(await readyLine(), "Ready: WEB-2, WEB-3 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
});

test("two dependencies closing at once announce their dependent once, and its status is right", async () => {
  const { kit, text, row, unblocked } = await managing();
  await text("issue_create", ISSUE);
  const builder = threadIn(await text("agent_start", { issue: "WEB-1" }));
  await text("issue_create", RESEARCH);
  const researcher = threadIn(await text("agent_start", { issue: "WEB-2" }));
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["WEB-1", "WEB-2"] });

  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  kit.github.prs.set(kit.thread(builder).environmentBranchName ?? assert.fail("no branch"), { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  await Promise.all([kit.idle(researcher, "Handed off."), kit.tick()]);
  await settled();
  const announced = await unblocked();
  assert.equal(announced.length, 1, announced.join("; "));
  assert.ok(announced[0] === "WEB-3 by WEB-1 done" || announced[0] === "WEB-3 by WEB-2 done", announced.join("; "));
  assert.equal(await row("WEB-3"), '- WEB-3 "Replay" (Build; no agent): Not started');
});

test("an agent on an issue depending on a research issue gets nothing of its report: its first message is a twin's with no dependency", async () => {
  const { kit, text, research } = await managing();
  const { report } = await research();
  await report();
  await text("issue_create", { ...ISSUE, dependsOn: ["WEB-1"] });
  await text("issue_create", ISSUE);
  const dependent = kit.thread(threadIn(await text("agent_start", { issue: "WEB-2" }))).spawnedWith.prompt ?? assert.fail("no prompt");
  const twin = kit.thread(threadIn(await text("agent_start", { issue: "WEB-3" }))).spawnedWith.prompt ?? assert.fail("no prompt");

  assert.doesNotMatch(dependent, /inside our PCI scope|reports\/WEB-1\.md|\bWEB-1\b/);
  assert.equal(dependent.replaceAll("a2", "aN").replaceAll("WEB-2", "iN"), twin.replaceAll("a3", "aN").replaceAll("WEB-3", "iN"));
});

test("the manager's cancel or a removed dependency names what became ready in its own result, and wakes nobody", async () => {
  const { kit, coordinatorId, text, row, unblocked } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["WEB-1"] });
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["WEB-1"], status: "backlog" });
  assert.equal(await text("issue_update", { id: "WEB-1", status: "canceled" }), "Updated WEB-1. Now ready: WEB-2.");
  assert.equal(await row("WEB-2"), '- WEB-2 "Dead letters" (Build; no agent): Not started');

  await text("issue_create", { ...ISSUE, title: "Metrics" });
  await text("issue_create", { ...ISSUE, title: "Alerts", dependsOn: ["WEB-4"] });
  assert.equal(await text("issue_update", { id: "WEB-5", dependsOn: { remove: ["WEB-4"] } }), "Updated WEB-5. Now ready: WEB-5.");
  assert.deepEqual(kit.store.issue(coordinatorId, issueIdSchema.parse("WEB-5"))?.dependsOn, []);
  assert.deepEqual(await unblocked(), []);
});

test("catch-up's ready line lists the Todo issues nothing blocks: not a blocked one, one in Backlog, one at work or one closed", async () => {
  const { text, readyLine } = await managing();
  assert.match(await text("crew_catch_up", {}), /## Board\n\nNo issues yet\./);
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["WEB-1"] });
  await text("issue_create", { ...ISSUE, title: "Replay", status: "backlog" });
  await text("issue_create", { ...ISSUE, title: "Metrics" });
  await text("issue_create", { ...ISSUE, title: "Alerts" });
  await text("agent_start", { issue: "WEB-4" });
  await text("issue_update", { id: "WEB-5", status: "canceled" });
  assert.equal(await readyLine(), "Ready: WEB-1 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
});

async function releaseAll(holds: { holding: boolean; held: (() => void)[] }): Promise<void> {
  holds.holding = false;
  while (holds.held.length > 0) {
    holds.held.splice(0).forEach((release) => release());
    await settled();
  }
}

test("an open dependency added while the announcement reads bb is seen: its dependent is not announced unblocked", async () => {
  const { kit, text, row, unblocked } = await managing();
  await text("issue_create", RESEARCH);
  const researcher = threadIn(await text("agent_start", { issue: "WEB-1" }));
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await text("issue_create", { ...ISSUE, title: "Vault access policy" });
  await settled();

  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  kit.threadLists.holding = true;
  const idled = kit.idle(researcher, "Handed off.");
  await settled();
  assert.ok(kit.threadLists.held.length > 0, "no listing held");
  kit.threadLists.holding = false;
  assert.equal(await text("issue_update", { id: "WEB-2", dependsOn: { add: ["WEB-3"] } }), "Updated WEB-2.");
  await releaseAll(kit.threadLists);
  await idled;
  await settled();

  assert.deepEqual(await unblocked(), []);
  assert.match(await row("WEB-2"), /; blocked by WEB-3 \(Todo\)$/);
});

test("a research agent's new turn while the announcement reads its turns announces nothing; its next report does, once", async () => {
  const { kit, text, row, unblocked, research } = await managing();
  const { agentThreadId, report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await settled();

  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  kit.turnEvents.holding = true;
  const idled = kit.idle(agentThreadId, "Handed off.");
  await settled();
  assert.ok(kit.turnEvents.held.length > 0, "no turn read held");
  await kit.starting(agentThreadId);
  await releaseAll(kit.turnEvents);
  await idled;
  await settled();

  assert.deepEqual(await unblocked(), []);
  assert.match(await row("WEB-2"), /; blocked by WEB-1 \(In progress\)$/);
  await kit.active(agentThreadId);
  await settled();
  assert.deepEqual(await unblocked(), []);
  await report();
  assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);
});

test("an agent thread's event that repeats its status reads no issue again, and refreshes the board; a new status reads them", async () => {
  const { kit, coordinatorId, text } = await managing();
  await text("issue_create", ISSUE);
  const builder = threadIn(await text("agent_start", { issue: "WEB-1" }));
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["WEB-1"] });
  await kit.threadNow(builder);
  await settled();

  kit.threadLists.holding = true;
  const boards = kit.invalidated().length;
  await kit.threadNow(builder);
  await settled();
  assert.deepEqual(kit.threadLists.held, []);
  assert.deepEqual(kit.invalidated().slice(boards), [`board:${coordinatorId}`]);
  await kit.starting(builder);
  await settled();
  assert.equal(kit.threadLists.held.length, 1);
  await releaseAll(kit.threadLists);

  await kit.idle(builder, "Done.");
  await settled();
  await releaseAll(kit.threadLists);
  kit.threadLists.holding = true;
  await settled();
  assert.deepEqual(kit.threadLists.held, []);
  await kit.starting(builder);
  await settled();
  assert.equal(kit.threadLists.held.length, 1, "the next turn's starting read nothing");
  await releaseAll(kit.threadLists);
});

async function reportThenEnd(how: "deleted" | "archived" | "deleted unseen") {
  const managed = await managing();
  const { kit, text, research } = managed;
  const { agentThreadId } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await settled();
  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  const thread = kit.thread(agentThreadId);
  if (how === "archived") {
    thread.archivedAt = Date.now();
    await kit.emit("thread.archived", { thread: kit.ref(agentThreadId) });
  } else {
    thread.deletedAt = Date.now();
    if (how === "deleted") await kit.emit("thread.deleted", { thread: kit.ref(agentThreadId) });
  }
  await kit.tick();
  await settled();
  return managed;
}

for (const how of ["deleted", "archived", "deleted unseen"] as const) {
  test(`a research agent whose thread is ${how} after its report, before its turn ends, unblocks its dependent once`, async () => {
    const { kit, row, unblocked } = await reportThenEnd(how);
    assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);
    assert.equal(await row("WEB-2"), '- WEB-2 "Card vault schema" (Build; no agent): Not started');
    kit.clock.now += 10 * 60_000;
    await kit.tick();
    await settled();
    assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);
  });
}

test("a research agent the tick ends in its issue's turn, after the tick's own pass read nothing to announce, unblocks its dependent from that turn", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await settled();
  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  kit.thread(agentThreadId).archivedAt = Date.now();
  let release = (): void => assert.fail("never held");
  kit.turnEvents.pending = new Promise<void>((resolve) => (release = resolve));
  await kit.tick();
  assert.deepEqual(await unblocked(), [], "the tick's pass ran while a1 still held WEB-1");

  kit.turnEvents.pending = null;
  release();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);
});

test("a research agent ended after its turn ended on its report announces nothing more", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId, report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await report();
  assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);

  kit.thread(agentThreadId).deletedAt = Date.now();
  await kit.emit("thread.deleted", { thread: kit.ref(agentThreadId) });
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);
});

test("merges whose announcement can't read bb are announced by a later tick, after a reload too, once each", async () => {
  const { kit, coordinatorId, text, unblocked } = await managing();
  await text("issue_create", ISSUE);
  const first = threadIn(await text("agent_start", { issue: "WEB-1" }));
  await text("issue_create", { ...ISSUE, title: "Dead letters" });
  const second = threadIn(await text("agent_start", { issue: "WEB-2" }));
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["WEB-1"] });
  await text("issue_create", { ...ISSUE, title: "Alerts", dependsOn: ["WEB-2"] });
  await text("issue_create", RESEARCH);
  const researcher = threadIn(await text("agent_start", { issue: "WEB-5" }));
  await kit.call("agent_handoff", { status: "blocked", ...FIELDS, summary: "Needs a PCI contact" }, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();

  const merged = (number: number): FakePr => ({ number, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  const branches = [first, second].map((agent) => kit.thread(agent).environmentBranchName ?? assert.fail("no branch"));
  branches.forEach((branch, i) => kit.github.prs.set(branch, merged(41 + i)));
  kit.turnEvents.failure = new Error("HTTP 503: bb is restarting");
  await kit.tick();
  await settled();
  assert.deepEqual(branches.map((branch) => kit.store.prOfBranch(coordinatorId, branch)?.snapshot?.state), ["merged", "merged"]);
  assert.ok(!kit.store.unannounced(coordinatorId).some(({ event }) => event.kind === "unblocked"), "announced while bb couldn't be read");

  kit.turnEvents.failure = null;
  kit.reload();
  kit.clock.now += 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual((await unblocked()).sort(), ["WEB-3 by WEB-1 done", "WEB-4 by WEB-2 done"]);
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual((await unblocked()).sort(), ["WEB-3 by WEB-1 done", "WEB-4 by WEB-2 done"]);
});

test("a dependency that closes after its dependent is filed is announced once, though the first read is overtaken, the next fails and the plugin reloads", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId } = await research();
  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  kit.threadLists.holding = true;
  const filing = text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await settled();
  kit.threadLists.held.splice(0).forEach((release) => release());
  assert.equal(await filing, "Filed WEB-2 (build) in Todo, blocked by WEB-1 (In progress).");
  await settled();
  assert.equal(kit.threadLists.held.length, 1, "the announcement's first read is not held");

  kit.threadLists.holding = false;
  await kit.idle(agentThreadId, "Handed off.");
  kit.threadLists.failure = new Error("HTTP 503: bb is restarting");
  kit.threadLists.held.splice(0).forEach((release) => release());
  await settled();
  assert.ok(kit.warnings().some((warning) => warning.includes("HTTP 503")), kit.warnings().join("; "));

  kit.threadLists.failure = null;
  kit.reload();
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-2 by WEB-1 done"]);
});

test("a dependency removed while open, closed meanwhile and added again closed announces nothing, though a read began before the removal", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId, report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  await settled();
  kit.threadLists.holding = true;
  await kit.active(agentThreadId);
  await settled();
  assert.equal(kit.threadLists.held.length, 1, "no read held");

  kit.threadLists.holding = false;
  assert.equal(await text("issue_update", { id: "WEB-2", dependsOn: { remove: ["WEB-1"] } }), "Updated WEB-2. Now ready: WEB-2.");
  await report();
  assert.equal(await text("issue_update", { id: "WEB-2", dependsOn: { add: ["WEB-1"] } }), "Updated WEB-2.");
  await releaseAll(kit.threadLists);

  assert.deepEqual(await unblocked(), []);
});

test("a regional manager whose reads keep being overtaken holds no other: the tick announces another's merge and rings it", async () => {
  const busy = await managing();
  const { kit } = busy;
  await busy.text("issue_create", ISSUE);
  await busy.text("agent_start", { issue: "WEB-1" });
  await busy.text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["WEB-1"] });
  const other = (await kit.startManager("Ship the billing export")).threadId;
  const call = async (tool: string, input: object) => textOf(await kit.call(tool, input, other));
  await call("issue_create", ISSUE);
  const builder = threadIn(await call("agent_start", { issue: "WEB-1" }));
  await call("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["WEB-1"] });
  kit.thread(other).status = "idle";
  await settled();

  kit.github.prs.set(kit.thread(builder).environmentBranchName ?? assert.fail("no branch"), { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  kit.threadLists.holding = true;
  let ticked = false;
  const ticking = kit.tick().then(() => {
    ticked = true;
  });
  for (let round = 0; round < 30 && !ticked; round++) {
    await settled();
    await busy.text("issue_update", { id: "WEB-1", title: `Add retries, round ${round}` });
    kit.threadLists.held.splice(0).forEach((release) => release());
  }
  const doorbells = kit.sent().filter((args) => args.threadId === other);
  const tickedWhileBusy = ticked;
  await releaseAll(kit.threadLists);
  await ticking;

  assert.ok(tickedWhileBusy, "the tick waited on the busy manager");
  const doorbell = doorbells.at(-1) ?? assert.fail("no doorbell");
  assert.match(doorbell.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"), /- WEB-2 "Dead letters" is unblocked: WEB-1 done$/);
});

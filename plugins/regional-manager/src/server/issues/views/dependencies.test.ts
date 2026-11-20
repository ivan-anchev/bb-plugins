// Dependencies end to end, through the tools as the regional manager and its agents reach them:
// "depends on" and "blocks", blocked derived on every read, a cycle refused when written, the ready
// list, and the unblocked announcements. A dependency informs and never refuses, and carries nothing.
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
  /** Every unblocked update a catch-up returned, in order, as "i3 by i1 done": a catch-up returns each event once, whether a doorbell named it or not. */
  const announced: string[] = [];
  const catchUp = async () => {
    const caughtUp = await text("crew_catch_up", {});
    for (const [, issue, by, as] of caughtUp.matchAll(/^### (i\d+) "[^"]*" is unblocked: (i\d+) (\w+)$/gm)) announced.push(`${issue} by ${by} ${as}`);
    return caughtUp;
  };
  const unblocked = async () => {
    await catchUp();
    return [...announced];
  };
  /** The board section of a catch-up: the rows and the ready line. */
  const board = async () => (await catchUp()).split("## Board\n\n")[1]?.split("\n\n## Decisions")[0] ?? assert.fail("no board");
  const row = async (id: string) => (await board()).split("\n").find((line) => line.startsWith(`- ${id} `)) ?? assert.fail(`no row for ${id}`);
  const readyLine = async () => (await board()).split("\n").find((line) => line.startsWith("Ready: ")) ?? assert.fail("no ready line");
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  /** The manager's turn ends, so the next doorbell reaches it at once. */
  const managerIdle = () => {
    kit.thread(threadId).status = "idle";
  };
  /** A research issue, i1, with an agent on it; the agent hands off its report and its turn ends. */
  async function research() {
    await text("issue_create", RESEARCH);
    const agentThreadId = threadIn(await text("agent_start", { issue: "i1" }));
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
  assert.equal(await text("issue_create", { ...ISSUE, dependsOn: ["i1"] }), "Filed i2 (build) in Todo, blocked by i1 (Todo).");

  const dependent = await text("issue_read", { id: "i2" });
  assert.match(dependent, /^Build\. Todo: Not started\. Blocked by i1 \(Todo\)\. Thread: no thread\.$/m);
  assert.match(dependent, /### Relations\n\nParent: none\.\nSub-issues: none\.\nDepends on: i1 \(Todo\)\.\nBlocks: nothing\./);
  assert.match(await text("issue_read", { id: "i1" }), /### Relations\n\nParent: none\.\nSub-issues: none\.\nDepends on: nothing\.\nBlocks: i2 \(Todo\)\./);
  assert.equal(await row("i2"), '- i2 "Add retries" (Build; no agent): Not started; blocked by i1 (Todo)');
  assert.equal(await row("i1"), '- i1 "Retry budget" (Build; no agent): Not started');
});

test("a dependency on no issue, on itself, or closing a cycle is refused naming it, and nothing of the change is written", async () => {
  const { kit, coordinatorId, call } = await managing();
  await call("issue_create", ISSUE);
  await call("issue_create", { ...ISSUE, dependsOn: ["i1"] });
  await call("issue_create", { ...ISSUE, dependsOn: ["i2"] });
  const plans = () => kit.store.issues(coordinatorId).map(({ id, title, dependsOn }) => [id, title, dependsOn]);
  const before = plans();

  assert.deepEqual(await call("issue_create", { ...ISSUE, dependsOn: ["i9"] }), { refused: true, text: "No issue filed: i4 can't depend on i9: there is no issue i9." });
  assert.deepEqual(await call("issue_update", { id: "i1", dependsOn: { add: ["i1"] } }), { refused: true, text: "i1 can't depend on itself." });
  assert.deepEqual(await call("issue_update", { id: "i1", title: "Retry budget", dependsOn: { add: ["i3"] } }), { refused: true, text: "i1 can't depend on i3: that would close a cycle, i1 → i3 → i2 → i1." });
  assert.deepEqual(plans(), before);
});

test("an agent starts on a blocked issue, and its result says what blocks it", async () => {
  const { text } = await managing();
  await text("issue_create", { ...ISSUE, title: "Retry budget" });
  await text("issue_create", { ...ISSUE, dependsOn: ["i1"] });
  const started = await text("agent_start", { issue: "i2" });
  assert.match(started, /^Started a1 on i2 as @thread:\w+, /);
  assert.match(started, / i2 is blocked by i1 \(Todo\): its agent started anyway, and has nothing of that work but what its brief names\.$/);
  assert.doesNotMatch(await text("agent_start", { issue: "i1" }), /blocked/);
});

test("a research dependency's report unblocks its dependent with a wake; a message to its agent blocks it again until the next report", async () => {
  const { call, text, catchUp, row, readyLine, doorbells, managerIdle, unblocked, research } = await managing();
  const { report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  assert.match(await row("i2"), /; blocked by i1 \(In progress\)$/);
  assert.equal(await readyLine(), "Ready: none (in Todo, no sub-issues, and nothing they or their parent depend on is open).");

  managerIdle();
  await report();
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /\n- i2 "Card vault schema" is unblocked: i1 done$/);
  assert.match(await catchUp(), /### i2 "Card vault schema" is unblocked: i1 done\n\nAt [^\n]* i1 was the last open issue blocking i2, as its own dependency or its parent's\. Nothing of i1 reaches i2 on its own:/);
  assert.equal(await row("i2"), '- i2 "Card vault schema" (Build; no agent): Not started');
  assert.equal(await readyLine(), "Ready: i2 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");

  await call("agent_message", { agent: "a1", text: "Add what KMS would cost." });
  assert.match(await row("i2"), /; blocked by i1 \(In progress\)$/);
  assert.equal(await readyLine(), "Ready: none (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
  await report({ ...RESEARCH_DONE, summary: "Vault fits; KMS costs more" });
  assert.deepEqual(await unblocked(), ["i2 by i1 done", "i2 by i1 done"]);
  assert.equal(await readyLine(), "Ready: i2 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
});

test("a handoff that closes nothing, or closes an issue nothing waits on, announces nothing", async () => {
  const { kit, threadId, text, unblocked, research } = await managing();
  const { report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await report({ status: "blocked", ...FIELDS, summary: "Needs a PCI contact" });
  assert.deepEqual(await unblocked(), []);

  await text("issue_create", { ...RESEARCH, title: "Pick a queue" });
  const other = threadIn(await text("agent_start", { issue: "i3" }));
  await kit.call("agent_handoff", RESEARCH_DONE, other);
  await kit.idle(other, "Handed off.");
  await settled();
  assert.deepEqual(await unblocked(), []);
  assert.match(textOf(await kit.call("issue_read", { id: "i2" }, threadId)), /Blocked by i1 \(In progress\)\./);
});

test("a build dependency whose pull request merges unblocks its dependent once; one still blocked by another is not announced", async () => {
  const { kit, text, readyLine, doorbells, managerIdle, unblocked } = await managing();
  await text("issue_create", ISSUE);
  const builder = threadIn(await text("agent_start", { issue: "i1" }));
  await text("issue_create", { ...RESEARCH, title: "Pick a queue" });
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["i1"] });
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["i1", "i2"] });
  managerIdle();

  const branch = kit.thread(builder).environmentBranchName ?? assert.fail("no branch");
  kit.github.prs.set(branch, { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  await kit.tick();
  await settled();
  assert.match(doorbells().at(-1) ?? assert.fail("no doorbell"), /- i1 "Add retries" \(a1\) PR #41: merged\n- i3 "Dead letters" is unblocked: i1 done$/);
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["i3 by i1 done"]);
  assert.equal(await readyLine(), "Ready: i2, i3 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
});

test("two dependencies closing at once announce their dependent once, and its status is right", async () => {
  const { kit, text, row, unblocked } = await managing();
  await text("issue_create", ISSUE);
  const builder = threadIn(await text("agent_start", { issue: "i1" }));
  await text("issue_create", RESEARCH);
  const researcher = threadIn(await text("agent_start", { issue: "i2" }));
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["i1", "i2"] });

  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  kit.github.prs.set(kit.thread(builder).environmentBranchName ?? assert.fail("no branch"), { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  await Promise.all([kit.idle(researcher, "Handed off."), kit.tick()]);
  await settled();
  const announced = await unblocked();
  assert.equal(announced.length, 1, announced.join("; "));
  assert.ok(announced[0] === "i3 by i1 done" || announced[0] === "i3 by i2 done", announced.join("; "));
  assert.equal(await row("i3"), '- i3 "Replay" (Build; no agent): Not started');
});

test("an agent on an issue depending on a research issue gets nothing of its report: its first message is a twin's with no dependency", async () => {
  const { kit, text, research } = await managing();
  const { report } = await research();
  await report();
  await text("issue_create", { ...ISSUE, dependsOn: ["i1"] });
  await text("issue_create", ISSUE);
  const dependent = kit.thread(threadIn(await text("agent_start", { issue: "i2" }))).spawnedWith.prompt ?? assert.fail("no prompt");
  const twin = kit.thread(threadIn(await text("agent_start", { issue: "i3" }))).spawnedWith.prompt ?? assert.fail("no prompt");

  assert.doesNotMatch(dependent, /inside our PCI scope|reports\/i1\.md|\bi1\b/);
  assert.equal(dependent.replaceAll("a2", "aN").replaceAll("i2", "iN"), twin.replaceAll("a3", "aN").replaceAll("i3", "iN"));
});

test("the manager's cancel or a removed dependency names what became ready in its own result, and wakes nobody", async () => {
  const { kit, coordinatorId, text, row, unblocked } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["i1"] });
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["i1"], status: "backlog" });
  assert.equal(await text("issue_update", { id: "i1", status: "canceled" }), "Updated i1. Now ready: i2.");
  assert.equal(await row("i2"), '- i2 "Dead letters" (Build; no agent): Not started');

  await text("issue_create", { ...ISSUE, title: "Metrics" });
  await text("issue_create", { ...ISSUE, title: "Alerts", dependsOn: ["i4"] });
  assert.equal(await text("issue_update", { id: "i5", dependsOn: { remove: ["i4"] } }), "Updated i5. Now ready: i5.");
  assert.deepEqual(kit.store.issue(coordinatorId, issueIdSchema.parse("i5"))?.dependsOn, []);
  assert.deepEqual(await unblocked(), []);
});

test("catch-up's ready line lists the Todo issues nothing blocks: not a blocked one, one in Backlog, one at work or one closed", async () => {
  const { text, readyLine } = await managing();
  assert.match(await text("crew_catch_up", {}), /## Board\n\nNo issues yet\./);
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["i1"] });
  await text("issue_create", { ...ISSUE, title: "Replay", status: "backlog" });
  await text("issue_create", { ...ISSUE, title: "Metrics" });
  await text("issue_create", { ...ISSUE, title: "Alerts" });
  await text("agent_start", { issue: "i4" });
  await text("issue_update", { id: "i5", status: "canceled" });
  assert.equal(await readyLine(), "Ready: i1 (in Todo, no sub-issues, and nothing they or their parent depend on is open).");
});

/** Releases every bb answer held, until none is: a release can lead to another held read. */
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
  const researcher = threadIn(await text("agent_start", { issue: "i1" }));
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await text("issue_create", { ...ISSUE, title: "Vault access policy" });
  await settled();

  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  kit.threadLists.holding = true;
  const idled = kit.idle(researcher, "Handed off.");
  await settled();
  assert.ok(kit.threadLists.held.length > 0, "no listing held");
  kit.threadLists.holding = false;
  assert.equal(await text("issue_update", { id: "i2", dependsOn: { add: ["i3"] } }), "Updated i2.");
  await releaseAll(kit.threadLists);
  await idled;
  await settled();

  assert.deepEqual(await unblocked(), []);
  assert.match(await row("i2"), /; blocked by i3 \(Todo\)$/);
});

test("a research agent's new turn while the announcement reads its turns announces nothing; its next report does, once", async () => {
  const { kit, text, row, unblocked, research } = await managing();
  const { agentThreadId, report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await settled();

  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  kit.turnEvents.holding = true;
  const idled = kit.idle(agentThreadId, "Handed off.");
  await settled();
  assert.ok(kit.turnEvents.held.length > 0, "no turn read held");
  // As when the user writes in the agent's thread: bb starts a turn, which only the thread's event says until it is active.
  await kit.starting(agentThreadId);
  await releaseAll(kit.turnEvents);
  await idled;
  await settled();

  assert.deepEqual(await unblocked(), []);
  assert.match(await row("i2"), /; blocked by i1 \(In progress\)$/);
  await kit.active(agentThreadId);
  await settled();
  assert.deepEqual(await unblocked(), []);
  await report();
  assert.deepEqual(await unblocked(), ["i2 by i1 done"]);
});

test("an agent thread's event that repeats its status reads no issue again, and refreshes the board; a new status reads them", async () => {
  const { kit, coordinatorId, text } = await managing();
  await text("issue_create", ISSUE);
  const builder = threadIn(await text("agent_start", { issue: "i1" }));
  await text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["i1"] });
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

  // A turn whose events said only `starting` ends; the next one's `starting` is news again.
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

/** A research agent hands off its report, and its thread then ends `how` before its turn does; the tick runs after. */
async function reportThenEnd(how: "deleted" | "archived" | "deleted unseen") {
  const managed = await managing();
  const { kit, text, research } = managed;
  const { agentThreadId } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await settled();
  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  const thread = kit.thread(agentThreadId);
  if (how === "archived") {
    thread.archivedAt = Date.now();
    await kit.emit("thread.archived", { thread: kit.ref(agentThreadId) });
  } else {
    thread.deletedAt = Date.now();
    // why no event for "deleted unseen": bb's thread.deleted was missed, as during a reload; the tick's reconcile ends the agent.
    if (how === "deleted") await kit.emit("thread.deleted", { thread: kit.ref(agentThreadId) });
  }
  await kit.tick();
  await settled();
  return managed;
}

for (const how of ["deleted", "archived", "deleted unseen"] as const) {
  test(`a research agent whose thread is ${how} after its report, before its turn ends, unblocks its dependent once`, async () => {
    const { kit, row, unblocked } = await reportThenEnd(how);
    assert.deepEqual(await unblocked(), ["i2 by i1 done"]);
    assert.equal(await row("i2"), '- i2 "Card vault schema" (Build; no agent): Not started');
    kit.clock.now += 10 * 60_000;
    await kit.tick();
    await settled();
    assert.deepEqual(await unblocked(), ["i2 by i1 done"]);
  });
}

test("a research agent the tick ends in its issue's turn, after the tick's own pass read nothing to announce, unblocks its dependent from that turn", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await settled();
  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  // why archived unseen, its turn read held: only the tick's reconcile ends a1, in i1's turn, which the tick doesn't wait for.
  kit.thread(agentThreadId).archivedAt = Date.now();
  let release = (): void => assert.fail("never held");
  kit.turnEvents.pending = new Promise<void>((resolve) => (release = resolve));
  await kit.tick();
  assert.deepEqual(await unblocked(), [], "the tick's pass ran while a1 still held i1");

  kit.turnEvents.pending = null;
  release();
  await settled();
  assert.deepEqual(await unblocked(), ["i2 by i1 done"]);
});

test("a research agent ended after its turn ended on its report announces nothing more", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId, report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await report();
  assert.deepEqual(await unblocked(), ["i2 by i1 done"]);

  kit.thread(agentThreadId).deletedAt = Date.now();
  await kit.emit("thread.deleted", { thread: kit.ref(agentThreadId) });
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["i2 by i1 done"]);
});

test("merges whose announcement can't read bb are announced by a later tick, after a reload too, once each", async () => {
  const { kit, coordinatorId, text, unblocked } = await managing();
  await text("issue_create", ISSUE);
  const first = threadIn(await text("agent_start", { issue: "i1" }));
  await text("issue_create", { ...ISSUE, title: "Dead letters" });
  const second = threadIn(await text("agent_start", { issue: "i2" }));
  await text("issue_create", { ...ISSUE, title: "Replay", dependsOn: ["i1"] });
  await text("issue_create", { ...ISSUE, title: "Alerts", dependsOn: ["i2"] });
  // why a research agent whose turn ended on a handoff: reading every issue then reads its turns, which neither the PR watch nor the agents' reconcile does.
  await text("issue_create", RESEARCH);
  const researcher = threadIn(await text("agent_start", { issue: "i5" }));
  await kit.call("agent_handoff", { status: "blocked", ...FIELDS, summary: "Needs a PCI contact" }, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();

  const merged = (number: number): FakePr => ({ number, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  const branches = [first, second].map((agent) => kit.thread(agent).environmentBranchName ?? assert.fail("no branch"));
  branches.forEach((branch, i) => kit.github.prs.set(branch, merged(41 + i)));
  kit.turnEvents.failure = new Error("HTTP 503: bb is restarting");
  await kit.tick();
  await settled();
  // why the store: a catch-up reads every issue, which bb can't answer now.
  assert.deepEqual(branches.map((branch) => kit.store.prOfBranch(coordinatorId, branch)?.snapshot?.state), ["merged", "merged"]);
  assert.ok(!kit.store.unannounced(coordinatorId).some(({ event }) => event.kind === "unblocked"), "announced while bb couldn't be read");

  kit.turnEvents.failure = null;
  kit.reload();
  kit.clock.now += 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual((await unblocked()).sort(), ["i3 by i1 done", "i4 by i2 done"]);
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual((await unblocked()).sort(), ["i3 by i1 done", "i4 by i2 done"]);
});

test("a dependency that closes after its dependent is filed is announced once, though the first read is overtaken, the next fails and the plugin reloads", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId } = await research();
  await kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
  kit.threadLists.holding = true;
  const filing = text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await settled();
  kit.threadLists.held.splice(0).forEach((release) => release());
  assert.equal(await filing, "Filed i2 (build) in Todo, blocked by i1 (In progress).");
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
  assert.deepEqual(await unblocked(), ["i2 by i1 done"]);
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["i2 by i1 done"]);
});

test("a dependency removed while open, closed meanwhile and added again closed announces nothing, though a read began before the removal", async () => {
  const { kit, text, unblocked, research } = await managing();
  const { agentThreadId, report } = await research();
  await text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  await settled();
  kit.threadLists.holding = true;
  await kit.active(agentThreadId);
  await settled();
  assert.equal(kit.threadLists.held.length, 1, "no read held");

  kit.threadLists.holding = false;
  assert.equal(await text("issue_update", { id: "i2", dependsOn: { remove: ["i1"] } }), "Updated i2. Now ready: i2.");
  await report();
  assert.equal(await text("issue_update", { id: "i2", dependsOn: { add: ["i1"] } }), "Updated i2.");
  await releaseAll(kit.threadLists);

  assert.deepEqual(await unblocked(), []);
});

test("a regional manager whose reads keep being overtaken holds no other: the tick announces another's merge and rings it", async () => {
  const busy = await managing();
  const { kit } = busy;
  await busy.text("issue_create", ISSUE);
  await busy.text("agent_start", { issue: "i1" });
  await busy.text("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["i1"] });
  const other = (await kit.startManager("Ship the billing export")).threadId;
  const call = async (tool: string, input: object) => textOf(await kit.call(tool, input, other));
  await call("issue_create", ISSUE);
  const builder = threadIn(await call("agent_start", { issue: "i1" }));
  await call("issue_create", { ...ISSUE, title: "Dead letters", dependsOn: ["i1"] });
  kit.thread(other).status = "idle";
  await settled();

  kit.github.prs.set(kit.thread(builder).environmentBranchName ?? assert.fail("no branch"), { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  kit.threadLists.holding = true;
  let ticked = false;
  const ticking = kit.tick().then(() => {
    ticked = true;
  });
  // Every bb read answers only after the busy manager changed something again, as a crew at work keeps doing.
  for (let round = 0; round < 30 && !ticked; round++) {
    await settled();
    await busy.text("issue_update", { id: "i1", title: `Add retries, round ${round}` });
    kit.threadLists.held.splice(0).forEach((release) => release());
  }
  const doorbells = kit.sent().filter((args) => args.threadId === other);
  const tickedWhileBusy = ticked;
  await releaseAll(kit.threadLists);
  await ticking;

  assert.ok(tickedWhileBusy, "the tick waited on the busy manager");
  const doorbell = doorbells.at(-1) ?? assert.fail("no doorbell");
  assert.match(doorbell.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"), /- i2 "Dead letters" is unblocked: i1 done$/);
});

// Sub-issues end to end, through the tools as the regional manager and its agents reach them: one
// level deep, a parent with no agent whose status rolls up from its sub-issues, the kinds a parent
// holds, a parent's dependencies blocking its sub-issues, and canceling a parent. Each test is one
// of issue 08's acceptance criteria, at the tools.
import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinating, HEAD, isRefusal, ISSUE, settled, textOf, threadIn } from "../test-harness.ts";

const RESEARCH = { kind: "research", title: "Pick a card vault", description: "Which vault fits our PCI scope.", brief: "Compare Vault and KMS.", doneCriteria: [] };
const FIELDS = { summary: "Vault fits our PCI scope", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
const RESEARCH_DONE = { status: "done", ...FIELDS, report: "## Recommendation\n\nVault." };
const BUILD_DONE = { status: "done", ...FIELDS, summary: "Retries land", headSha: HEAD };

async function managing(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  const call = async (tool: string, input: object) => {
    const result = await kit.call(tool, input, threadId);
    return { refused: isRefusal(result), text: textOf(result) };
  };
  const text = async (tool: string, input: object) => (await call(tool, input)).text;
  const announced: string[] = [];
  const catchUp = async () => {
    const caughtUp = await text("crew_catch_up", {});
    for (const [, issue, by, as] of caughtUp.matchAll(/^### (i\d+) "[^"]*" is unblocked: (i\d+) (\w+)$/gm)) announced.push(`${issue} by ${by} ${as}`);
    return caughtUp;
  };
  /** The board section of a catch-up: the lanes and the ready line. */
  const board = async () => (await catchUp()).split("## Board\n\n")[1]?.split("\n\n## Decisions")[0] ?? assert.fail("no board");
  const statuses = async () => Object.fromEntries((await kit.rpc.board({ coordinatorId })).issues.map(({ id, status }) => [id, status]));
  /** Starts an agent on the issue; returns its thread. */
  const started = async (issue: string) => threadIn(await text("agent_start", { issue }));
  return { kit, threadId, coordinatorId, call, text, catchUp, board, statuses, started, unblocked: async () => (await catchUp(), [...announced]) };
}

/** Lets every answer `holds` kept go, and the ones asked for meanwhile, until none is left. */
async function releaseAll(holds: { holding: boolean; held: (() => void)[] }): Promise<void> {
  holds.holding = false;
  while (holds.held.length > 0) {
    holds.held.splice(0).forEach((release) => release());
    await settled();
  }
}

test("1: issue_create with a parent files a sub-issue, listed under its parent in issue_read and in the catch-up", async () => {
  const { text, board } = await managing();
  await text("issue_create", ISSUE);
  assert.equal(await text("issue_create", { ...RESEARCH, parent: "i1" }), "Filed i2 (research) as a sub-issue of i1 in Todo.");
  assert.match(await text("issue_read", { id: "i1" }), /### Relations\n\nParent: none\.\nSub-issues: i2 \(Todo\)\./);
  assert.match(await text("issue_read", { id: "i2" }), /### Relations\n\nParent: i1 \(Todo\)\.\nSub-issues: none\./);
  assert.equal(
    await board(),
    ['### Todo (1)\n- i1 "Add retries" (Build; parent): 0/1 done\n  - i2 "Pick a card vault" (Research; no agent, under i1): Not started', "Ready: i2 (in Todo, no sub-issues, and nothing they or their parent depend on is open)."].join("\n\n"),
  );
});

test("2: a sub-issue of a sub-issue, a parent for an issue with sub-issues, and a kind its parent doesn't hold are refused with the reason and a way the plan takes, filing and changing nothing", async () => {
  const { call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "i1" });
  await text("issue_create", { ...RESEARCH, title: "Which queue" });
  await text("issue_create", { ...RESEARCH, title: "Which broker", parent: "i3" });
  const before = await statuses();

  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "i2" }), {
    refused: true,
    text: "No issue filed: i5 can't be a sub-issue of i2: i2 is a sub-issue of i1, and sub-issues go one level deep. Put i5 under i1 instead.",
  });
  assert.deepEqual(await call("issue_update", { id: "i1", parent: "i3" }), {
    refused: true,
    text: "i1 can't be a sub-issue of i3: it has sub-issues of its own (i2), and sub-issues go one level deep. Make i2 top-level first with parent: null, then put i1 under an open top-level build issue, or leave i1 top-level.",
  });
  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "i3" }), {
    refused: true,
    text: "No issue filed: i5 can't be a build sub-issue of i3: a research issue holds only research sub-issues. Give i5 no parent, or an open top-level build issue as its parent.",
  });
  assert.deepEqual(await call("issue_update", { id: "i1", kind: "research" }), {
    refused: true,
    text: "i1 can't be research: it holds i2 (build), and a research issue holds only research sub-issues. Keep its kind, or make i2 top-level first with parent: null.",
  });
  assert.deepEqual(await statuses(), before);
  assert.equal(await text("issue_update", { id: "i4", parent: "i1" }), "Updated i4. Now ready: i3.", "a build parent holds research, and i3, with no sub-issue left, is ready");
  assert.equal(await text("issue_update", { id: "i4", parent: null }), "Updated i4.", "and top-level again");
});

test("the way a refusal offers an issue with sub-issues is one the tools take, when the issue is put under its own sub-issue and when its sub-issues are Done", async () => {
  const own = await managing();
  await own.text("issue_create", RESEARCH);
  await own.text("issue_create", { ...RESEARCH, title: "Vault", parent: "i1" });
  assert.deepEqual(await own.call("issue_update", { id: "i1", parent: "i2" }), {
    refused: true,
    text: "i1 can't be a sub-issue of i2: i2 is a sub-issue of i1, and sub-issues go one level deep. Make i2 top-level first with parent: null, then put i1 under an open top-level build or research issue, or leave i1 top-level.",
  });
  assert.equal(await own.text("issue_update", { id: "i2", parent: null }), "Updated i2. Now ready: i1.");
  assert.equal(await own.text("issue_update", { id: "i1", parent: "i2" }), "Updated i1.");
  assert.deepEqual((await own.kit.rpc.board({ coordinatorId: own.coordinatorId })).issues.map(({ id, parentId }) => [id, parentId]), [["i1", "i2"], ["i2", null]]);

  const done = await managing();
  await done.text("issue_create", RESEARCH);
  await done.text("issue_create", { ...RESEARCH, title: "Vault", parent: "i1" });
  await done.text("issue_create", { ...RESEARCH, title: "Which broker" });
  const researcher = await done.started("i2");
  await done.kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await done.kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await done.statuses(), { i1: "done", i2: "done", i3: "todo" });
  assert.deepEqual(await done.call("issue_update", { id: "i1", parent: "i3" }), {
    refused: true,
    text: "i1 can't be a sub-issue of i3: it has sub-issues of its own (i2), and sub-issues go one level deep. Make i2 top-level first with parent: null, then put i1 under an open top-level build or research issue, or leave i1 top-level.",
  });
  assert.equal(await done.text("issue_update", { id: "i2", parent: null }), "Updated i2. Now ready: i1.");
  assert.equal(await done.text("issue_update", { id: "i1", parent: "i3" }), "Updated i1.");
  assert.deepEqual(await done.statuses(), { i1: "todo", i2: "done", i3: "todo" }, "i3, joined by no Done work, stays open");
});

test("3: agent_start on a parent is refused,and so is filing a sub-issue under an issue an agent holds, naming the agent", async () => {
  const { kit, call, text } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "i1" });
  assert.deepEqual(await call("agent_start", { issue: "i1" }), { refused: true, text: "agent_start is refused: i1 has sub-issues (i2), and a parent has no agent of its own: start agents on them." });

  await text("issue_create", { ...ISSUE, title: "Replay" });
  await text("agent_start", { issue: "i3" });
  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "i3" }), {
    refused: true,
    text: "No issue filed: i4 can't be a sub-issue of i3: a1 holds i3, and a parent has no agent, so i3 can't be split now. Stop a1 with agent_stop first.",
  });
  assert.deepEqual(await call("issue_update", { id: "i2", parent: "i3" }), {
    refused: true,
    text: "i2 can't be a sub-issue of i3: a1 holds i3, and a parent has no agent, so i3 can't be split now. Stop a1 with agent_stop first.",
  });
  assert.equal(kit.store.issues(kit.store.coordinators()[0]?.id ?? assert.fail("no manager")).length, 3);
});

test("4: a parent's dependency blocks its sub-issue, which isn't ready; when it closes, the sub-issue is announced unblocked, once, and the parent never", async () => {
  const { kit, text, board, unblocked } = await managing();
  await text("issue_create", RESEARCH);
  const researcher = threadIn(await text("agent_start", { issue: "i1" }));
  await text("issue_create", { ...ISSUE, title: "Card vault", dependsOn: ["i1"] });
  assert.equal(await text("issue_create", { ...ISSUE, title: "Vault schema", parent: "i2" }), "Filed i3 (build) as a sub-issue of i2 in Todo, blocked by i1 (In progress).");
  await text("issue_create", { ...ISSUE, title: "Vault client", parent: "i2", status: "backlog" });
  assert.match(await board(), /\n {2}- i3 "Vault schema" \(Build; no agent, under i2\): Not started; blocked by i1 \(In progress\)\n/);
  assert.match(await board(), /Ready: none /);
  assert.match(await text("issue_read", { id: "i3" }), /Blocked by i1 \(In progress\)\./);

  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await unblocked(), ["i3 by i1 done", "i4 by i1 done"], "each open sub-issue, Backlog too, as any dependent is; never the parent i2");
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["i3 by i1 done", "i4 by i1 done"]);
  assert.match(await board(), /Ready: i3 /);
});

test("5: a parent rolls up: Todo while its sub-issues are, In progress once one is; a flagged sub-issue is listed under its parent and under Needs you", async () => {
  const { kit, text, board, statuses, started } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "i1" });
  await text("issue_create", { ...ISSUE, title: "Replay", parent: "i1" });
  assert.deepEqual(await statuses(), { i1: "todo", i2: "todo", i3: "todo" });
  const agentThreadId = await started("i2");
  assert.deepEqual(await statuses(), { i1: "in-progress", i2: "in-progress", i3: "todo" });

  await kit.call("agent_handoff", { status: "blocked", ...FIELDS, summary: "Needs a staging key" }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const blockedRow = `- i2 "Dead letters" (Build; a1, @thread:${agentThreadId}, under i1, on branch \`bb/${agentThreadId}\`): Blocked: Needs a staging key`;
  const lanes = await board();
  assert.ok(lanes.startsWith(`### Needs you (1)\n${blockedRow}\n\n### In progress (1)\n- i1 "Add retries" (Build; parent): 0/2 done\n  ${blockedRow}\n  - i3 `), lanes);
});

test("6: a research parent is Done when its last sub-issue closes; a build parent waits In review once all are merged and is accepted; one accepted unmerged is flagged", async () => {
  const research = await managing();
  await research.text("issue_create", RESEARCH);
  await research.text("issue_create", { ...RESEARCH, title: "Vault", parent: "i1" });
  await research.text("issue_create", { ...RESEARCH, title: "KMS", parent: "i1" });
  await research.text("issue_update", { id: "i3", status: "canceled" });
  const researcher = await research.started("i2");
  await research.kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await research.kit.idle(researcher, "Handed off.");
  assert.deepEqual(await research.statuses(), { i1: "done", i2: "done", i3: "canceled" });

  const build = await managing({ verify: false });
  await build.text("issue_create", ISSUE);
  await build.text("issue_create", { ...ISSUE, title: "Dead letters", parent: "i1" });
  await build.text("issue_create", { ...RESEARCH, parent: "i1" });
  const builder = await build.started("i2");
  const researcher2 = await build.started("i3");
  await build.kit.call("agent_handoff", RESEARCH_DONE, researcher2);
  await build.kit.idle(researcher2, "Handed off.");
  await build.kit.call("agent_handoff", BUILD_DONE, builder);
  await build.kit.idle(builder, "Handed off.");
  assert.deepEqual(await build.call("issue_update", { id: "i1", status: "done" }), { refused: true, text: "i1 is In progress (1/2 done), so it can't be marked Done: only an issue In review can." });

  assert.equal(await build.text("issue_update", { id: "i2", status: "done" }), "Updated i2.");
  const flag = "i2 isn't merged, so i1's work isn't all on the default branch";
  assert.match(await build.board(), new RegExp(`### Needs you \\(1\\)\\n- i1 "Add retries" \\(Build; parent\\): ${flag}\\n`));

  build.kit.github.prs.set(build.kit.thread(builder).environmentBranchName ?? assert.fail("no branch"), { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  build.kit.clock.now += 10 * 60_000;
  await build.kit.tick();
  assert.deepEqual(await build.statuses(), { i1: "in-review", i2: "done", i3: "done" });
  assert.equal(await build.text("issue_update", { id: "i1", status: "done" }), "Updated i1.");
  assert.deepEqual(await build.statuses(), { i1: "done", i2: "done", i3: "done" });
});

test("7: a parent is canceled only once its sub-issues are closed; every sub-issue canceled leaves it where the manager rested it", async () => {
  const { call, text, statuses } = await managing();
  await text("issue_create", { ...ISSUE, status: "backlog" });
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "i1" });
  await text("issue_create", { ...ISSUE, title: "Replay", parent: "i1" });
  await text("issue_update", { id: "i2", status: "canceled" });
  assert.deepEqual(await call("issue_update", { id: "i1", status: "canceled" }), { refused: true, text: "i1 can't be canceled while sub-issues of it are open: i3. Cancel them, or let them finish, first." });

  await text("issue_update", { id: "i3", status: "canceled" });
  assert.deepEqual(await statuses(), { i1: "backlog", i2: "canceled", i3: "canceled" });
  assert.equal(await text("issue_update", { id: "i1", status: "canceled" }), "Updated i1.");
  assert.deepEqual(await statuses(), { i1: "canceled", i2: "canceled", i3: "canceled" });
  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "i1" }), { refused: true, text: "No issue filed: i4 can't be a sub-issue of i1: i1 is closed. Give i4 no parent, or an open top-level build issue as its parent." });
});

type Manager = Awaited<ReturnType<typeof managing>>;

/**
 * A manager with i1 and i2, an agent on i2, i1 changed as `first` says, then the filing of a
 * sub-issue of i1 held at bb's listing while `meanwhile` writes the manager's act straight to the
 * store: no change is counted, so only the rows the write holds can say it. The filing's result,
 * and every status after.
 */
async function filedUnderI1While(first: object, meanwhile: (store: Manager["kit"]["store"], id: Manager["coordinatorId"]) => void) {
  const { kit, coordinatorId, call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters" });
  await text("agent_start", { issue: "i2" });
  await text("issue_update", { id: "i1", ...first });
  await settled();
  kit.threadLists.holding = true;
  const filing = call("issue_create", { ...ISSUE, title: "Replay", parent: "i1" });
  await settled();
  assert.ok(kit.threadLists.held.length > 0, "no listing held");
  meanwhile(kit.store, coordinatorId);
  await releaseAll(kit.threadLists);
  return { result: await filing, statuses: await statuses() };
}

const I1 = issueIdSchema.parse("i1");

test("filing a sub-issue is judged on its parent as stored when it is written: canceled while bb was read, refused; reopened meanwhile, filed", async () => {
  const canceled = await filedUnderI1While({ title: "Add retries" }, (store, id) => store.updateIssue(id, I1, { closed: { as: "canceled", at: 2_000 } }, { requireUnheld: true, closes: new Map() }));
  assert.deepEqual(canceled.result, { refused: true, text: "No issue filed: i3 can't be a sub-issue of i1: i1 is closed. Give i3 no parent, or an open top-level build issue as its parent." });
  assert.deepEqual(canceled.statuses, { i1: "canceled", i2: "in-progress" });

  const reopened = await filedUnderI1While({ status: "canceled" }, (store, id) => store.updateIssue(id, I1, { closed: null }, { requireUnheld: true, closes: new Map() }));
  assert.deepEqual(reopened.result, { refused: false, text: "Filed i3 (build) as a sub-issue of i1 in Todo." });
});

test("canceling a parent is judged on its sub-issues as they are when it is written: one reopened by a message while bb's turns were read keeps it open", async () => {
  const { kit, call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...RESEARCH, parent: "i1" });
  const researcher = threadIn(await text("agent_start", { issue: "i2" }));
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await statuses(), { i1: "in-review", i2: "done" });

  kit.turnEvents.holding = true;
  const canceling = call("issue_update", { id: "i1", status: "canceled" });
  await settled();
  assert.ok(kit.turnEvents.held.length > 0, "no turn read held");
  await text("agent_message", { agent: "a1", text: "Please revise the report." });
  await releaseAll(kit.turnEvents);

  assert.deepEqual(await canceling, { refused: true, text: "i1 can't be canceled while sub-issues of it are open: i2. Cancel them, or let them finish, first." });
  assert.deepEqual(await statuses(), { i1: "in-progress", i2: "in-progress" });
});

test("two plan writes whose reads both finished first are judged in turn: a sub-issue moved out closes its research parent, and the filing under that parent read beside it is refused", async () => {
  const { kit, call, text, statuses, started } = await managing();
  await text("issue_create", RESEARCH);
  await text("issue_create", { ...RESEARCH, title: "Vault", parent: "i1" });
  await text("issue_create", { ...RESEARCH, title: "KMS", parent: "i1" });
  const researcher = await started("i2");
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await statuses(), { i1: "in-progress", i2: "done", i3: "todo" });

  kit.turnEvents.holding = true;
  const moving = call("issue_update", { id: "i3", parent: null });
  const filing = call("issue_create", { ...RESEARCH, title: "HSM", parent: "i1" });
  await settled();
  assert.equal(kit.turnEvents.held.length, 2, "both writes' reads held");
  // Both reads answer in one go: the filing's read is done before the move's caller resumes from its write.
  await releaseAll(kit.turnEvents);

  assert.deepEqual(await moving, { refused: false, text: "Updated i3." });
  assert.deepEqual(await filing, { refused: true, text: "No issue filed: i4 can't be a sub-issue of i1: i1 is closed. Give i4 no parent, or an open top-level build or research issue as its parent." });
  assert.deepEqual(await statuses(), { i1: "done", i2: "done", i3: "todo" });
});

test("a plan write whose reads keep being overtaken writes nothing and says to try again", async () => {
  const { kit, call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters" });
  await text("agent_start", { issue: "i2" });
  await settled();
  kit.threadLists.holding = true;
  let answered = false;
  const filing = call("issue_create", { ...ISSUE, title: "Replay", parent: "i1" }).finally(() => {
    answered = true;
  });
  // Every bb read answers only after the manager changed something again, as a crew at work keeps doing.
  for (let round = 0; round < 10 && !answered; round++) {
    await settled();
    await text("issue_update", { id: "i2", title: `Dead letters, round ${round}` });
    kit.threadLists.held.splice(0).forEach((release) => release());
  }
  await releaseAll(kit.threadLists);

  assert.deepEqual(await filing, { refused: true, text: "No issue filed: your issues kept changing while they were read, so nothing was written. Try again." });
  assert.deepEqual(await statuses(), { i1: "todo", i2: "in-progress" });
  assert.equal(await text("issue_create", { ...ISSUE, title: "Replay", parent: "i1" }), "Filed i3 (build) as a sub-issue of i1 in Todo.");
});

/** A research parent i1 with research sub-issues i2 and i3, i4 depending on i1, and one more research sub-issue per `more`, filed i5 on. */
async function researchFamily(more = 0) {
  const manager = await managing();
  await manager.text("issue_create", RESEARCH);
  await manager.text("issue_create", { ...RESEARCH, title: "Vault", parent: "i1" });
  await manager.text("issue_create", { ...RESEARCH, title: "KMS", parent: "i1" });
  await manager.text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["i1"] });
  for (let n = 0; n < more; n++) await manager.text("issue_create", { ...RESEARCH, title: `Option ${n + 1}`, parent: "i1" });
  /**
   * The agent on the thread reports, and its turn ends. why settled first: the announcement reads a
   * few times at most while changes keep coming, then waits for the next change or tick, and an
   * agent just started is several changes.
   */
  const report = async (agentThreadId: string) => {
    await settled();
    await manager.kit.call("agent_handoff", RESEARCH_DONE, agentThreadId);
    await manager.kit.idle(agentThreadId, "Handed off.");
    await settled();
  };
  return { ...manager, report };
}

test("a research parent closed by its last report wakes its dependents once, though the manager canceled a sibling after that report was handed off and before its turn ended", async () => {
  const { kit, text, statuses, started, unblocked } = await researchFamily();
  const researcher = await started("i2");
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await settled();
  assert.equal(await text("issue_update", { id: "i3", status: "canceled" }), "Updated i3.");
  assert.deepEqual(await statuses(), { i1: "in-progress", i2: "in-progress", i3: "canceled", i4: "todo" });

  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await statuses(), { i1: "done", i2: "done", i3: "canceled", i4: "todo" });
  assert.deepEqual(await unblocked(), ["i4 by i1 done"]);
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["i4 by i1 done"]);
});

test("moving a canceled or a Done sub-issue out of a Done research parent wakes nobody; the manager's cancel that closed it wakes its dependent at most once beside its own result", async () => {
  const { text, statuses, started, report, unblocked } = await researchFamily(1);
  await report(await started("i2"));
  await report(await started("i3"));
  assert.deepEqual(await unblocked(), []);
  // The manager's own act is the step that closes i1: its result says what became ready, and one wake may say it again.
  assert.equal(await text("issue_update", { id: "i5", status: "canceled" }), "Updated i5. Now ready: i4.");
  await settled();
  const woken = await unblocked();
  assert.ok(woken.length <= 1, woken.join("; "));

  assert.equal(await text("issue_update", { id: "i5", parent: null }), "Updated i5.");
  await settled();
  assert.equal(await text("issue_update", { id: "i3", parent: null }), "Updated i3.");
  await settled();
  assert.deepEqual(await statuses(), { i1: "done", i2: "done", i3: "done", i4: "todo", i5: "canceled" });
  assert.deepEqual(await unblocked(), woken);
});

test("a research parent's sub-issue reopened by a message and reported again wakes the parent's dependents again, once", async () => {
  const { kit, text, statuses, started, report, unblocked } = await researchFamily();
  const researcher = await started("i2");
  await report(researcher);
  await report(await started("i3"));
  assert.deepEqual(await unblocked(), ["i4 by i1 done"]);

  await text("agent_message", { agent: "a1", text: "Add what KMS would cost." });
  await settled();
  assert.deepEqual(await statuses(), { i1: "in-progress", i2: "in-progress", i3: "done", i4: "todo" });
  assert.deepEqual(await unblocked(), ["i4 by i1 done"]);
  await report(researcher);
  assert.deepEqual(await unblocked(), ["i4 by i1 done", "i4 by i1 done"]);
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["i4 by i1 done", "i4 by i1 done"]);
});

test("a research parent's last two sub-issues closing together wake its dependents once", async () => {
  const { kit, started, unblocked } = await researchFamily();
  const one = await started("i2");
  const two = await started("i3");
  await kit.call("agent_handoff", RESEARCH_DONE, one);
  await kit.call("agent_handoff", RESEARCH_DONE, two);
  kit.threadLists.holding = true;
  await Promise.all([kit.idle(one, "Handed off."), kit.idle(two, "Handed off.")]);
  await releaseAll(kit.threadLists);
  assert.deepEqual(await unblocked(), ["i4 by i1 done"]);
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["i4 by i1 done"]);
});

test("the board's rows carry each issue's parent and a parent's count of Done sub-issues, and nothing else new", async () => {
  const { kit, coordinatorId, text, started } = await managing();
  await text("issue_create", RESEARCH);
  await text("issue_create", { ...RESEARCH, title: "Vault", parent: "i1" });
  const rows = async () => (await kit.rpc.board({ coordinatorId })).issues;
  const unstarted = { needsYou: null, agent: null, pr: null };
  assert.deepEqual(await rows(), [
    { id: "i1", kind: "research", parentId: null, subIssues: { done: 0, total: 1 }, title: "Pick a card vault", status: "todo", headline: "0/1 done", ...unstarted },
    { id: "i2", kind: "research", parentId: "i1", subIssues: null, title: "Vault", status: "todo", headline: "Not started", ...unstarted },
  ]);

  const researcher = await started("i2");
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  assert.deepEqual(await rows(), [
    { id: "i1", kind: "research", parentId: null, subIssues: { done: 1, total: 1 }, title: "Pick a card vault", status: "done", headline: "1/1 done", ...unstarted },
    {
      id: "i2",
      kind: "research",
      parentId: "i1",
      subIssues: null,
      title: "Vault",
      status: "done",
      needsYou: null,
      headline: "Handed off: Vault fits our PCI scope",
      agent: { id: "a1", threadId: researcher },
      pr: null,
    },
  ]);
});

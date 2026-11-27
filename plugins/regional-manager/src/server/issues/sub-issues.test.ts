// Sub-issues end to end, through the tools as the regional manager and its agents reach them: one
// level deep, a parent with no agent whose status rolls up from its sub-issues, the kinds a parent
// holds, a parent's dependencies blocking its sub-issues, and canceling a parent. Each test is one
// of issue 08's acceptance criteria, at the tools.
import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinating, HEAD, isRefusal, ISSUE, settled, textOf, threadIn, withoutLinks } from "../test-harness.ts";

const RESEARCH = { kind: "research", title: "Pick a card vault", description: "Which vault fits our PCI scope.", brief: "Compare Vault and KMS.", doneCriteria: [] };
const FIELDS = { summary: "Vault fits our PCI scope", did: [], evidence: [], concerns: [], deviations: [], findings: [], attachments: [] };
const RESEARCH_DONE = { status: "done", ...FIELDS, report: "## Recommendation\n\nVault." };
const BUILD_DONE = { status: "done", ...FIELDS, summary: "Retries land", headSha: HEAD };

async function managing(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  // why without links: each issue's link is issues.test.ts's to prove; here, its lane and relations.
  const call = async (tool: string, input: object) => {
    const result = await kit.call(tool, input, threadId);
    return { refused: isRefusal(result), text: withoutLinks(textOf(result)) };
  };
  const text = async (tool: string, input: object) => (await call(tool, input)).text;
  const announced: string[] = [];
  const catchUp = async () => {
    const caughtUp = await text("crew_catch_up", {});
    for (const [, issue, by, as] of caughtUp.matchAll(/^### (WEB-\d+) "[^"]*" is unblocked: (WEB-\d+) (\w+)$/gm)) announced.push(`${issue} by ${by} ${as}`);
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
  assert.equal(await text("issue_create", { ...RESEARCH, parent: "WEB-1" }), "Filed WEB-2 (research) as a sub-issue of WEB-1 in Todo.");
  assert.match(await text("issue_read", { id: "WEB-1" }), /### Relations\n\nParent: none\.\nSub-issues: WEB-2 \(Todo\)\./);
  assert.match(await text("issue_read", { id: "WEB-2" }), /### Relations\n\nParent: WEB-1 \(Todo\)\.\nSub-issues: none\./);
  assert.equal(
    await board(),
    ['### Todo (1)\n- WEB-1 "Add retries" (Build; parent): 0/1 done\n  - WEB-2 "Pick a card vault" (Research; no agent, under WEB-1): Not started', "Ready: WEB-2 (in Todo, no sub-issues, nothing they or their parent depend on is open, and no question at their cap of failed verifications waits for the user)."].join("\n\n"),
  );
});

test("2: a sub-issue of a sub-issue, a parent for an issue with sub-issues, and a kind its parent doesn't hold are refused with the reason and a way the plan takes, filing and changing nothing", async () => {
  const { call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "WEB-1" });
  await text("issue_create", { ...RESEARCH, title: "Which queue" });
  await text("issue_create", { ...RESEARCH, title: "Which broker", parent: "WEB-3" });
  const before = await statuses();

  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "WEB-2" }), {
    refused: true,
    text: "No issue filed: WEB-5 can't be a sub-issue of WEB-2: WEB-2 is a sub-issue of WEB-1, and sub-issues go one level deep. Put WEB-5 under WEB-1 instead.",
  });
  assert.deepEqual(await call("issue_update", { id: "WEB-1", parent: "WEB-3" }), {
    refused: true,
    text: "WEB-1 can't be a sub-issue of WEB-3: it has sub-issues of its own (WEB-2), and sub-issues go one level deep. Make WEB-2 top-level first with parent: null, then put WEB-1 under an open top-level build issue, or leave WEB-1 top-level.",
  });
  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "WEB-3" }), {
    refused: true,
    text: "No issue filed: WEB-5 can't be a build sub-issue of WEB-3: a research issue holds only research sub-issues. Give WEB-5 no parent, or an open top-level build issue as its parent.",
  });
  assert.deepEqual(await call("issue_update", { id: "WEB-1", kind: "research" }), {
    refused: true,
    text: "WEB-1 can't be research: it holds WEB-2 (build), and a research issue holds only research sub-issues. Keep its kind, or make WEB-2 top-level first with parent: null.",
  });
  assert.deepEqual(await statuses(), before);
  assert.equal(await text("issue_update", { id: "WEB-4", parent: "WEB-1" }), "Updated WEB-4. Now ready: WEB-3.", "a build parent holds research, and WEB-3, with no sub-issue left, is ready");
  assert.equal(await text("issue_update", { id: "WEB-4", parent: null }), "Updated WEB-4.", "and top-level again");
});

test("the way a refusal offers an issue with sub-issues is one the tools take, when the issue is put under its own sub-issue and when its sub-issues are Done", async () => {
  const own = await managing();
  await own.text("issue_create", RESEARCH);
  await own.text("issue_create", { ...RESEARCH, title: "Vault", parent: "WEB-1" });
  assert.deepEqual(await own.call("issue_update", { id: "WEB-1", parent: "WEB-2" }), {
    refused: true,
    text: "WEB-1 can't be a sub-issue of WEB-2: WEB-2 is a sub-issue of WEB-1, and sub-issues go one level deep. Make WEB-2 top-level first with parent: null, then put WEB-1 under an open top-level build or research issue, or leave WEB-1 top-level.",
  });
  assert.equal(await own.text("issue_update", { id: "WEB-2", parent: null }), "Updated WEB-2. Now ready: WEB-1.");
  assert.equal(await own.text("issue_update", { id: "WEB-1", parent: "WEB-2" }), "Updated WEB-1.");
  assert.deepEqual((await own.kit.rpc.board({ coordinatorId: own.coordinatorId })).issues.map(({ id, parentId }) => [id, parentId]), [["WEB-1", "WEB-2"], ["WEB-2", null]]);

  const done = await managing();
  await done.text("issue_create", RESEARCH);
  await done.text("issue_create", { ...RESEARCH, title: "Vault", parent: "WEB-1" });
  await done.text("issue_create", { ...RESEARCH, title: "Which broker" });
  const researcher = await done.started("WEB-2");
  await done.kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await done.kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await done.statuses(), { "WEB-1": "done", "WEB-2": "done", "WEB-3": "todo" });
  assert.deepEqual(await done.call("issue_update", { id: "WEB-1", parent: "WEB-3" }), {
    refused: true,
    text: "WEB-1 can't be a sub-issue of WEB-3: it has sub-issues of its own (WEB-2), and sub-issues go one level deep. Make WEB-2 top-level first with parent: null, then put WEB-1 under an open top-level build or research issue, or leave WEB-1 top-level.",
  });
  assert.equal(await done.text("issue_update", { id: "WEB-2", parent: null }), "Updated WEB-2. Now ready: WEB-1.");
  assert.equal(await done.text("issue_update", { id: "WEB-1", parent: "WEB-3" }), "Updated WEB-1.");
  assert.deepEqual(await done.statuses(), { "WEB-1": "todo", "WEB-2": "done", "WEB-3": "todo" }, "WEB-3, joined by no Done work, stays open");
});

test("3: agent_start on a parent is refused,and so is filing a sub-issue under an issue an agent holds, naming the agent", async () => {
  const { kit, call, text } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "WEB-1" });
  assert.deepEqual(await call("agent_start", { issue: "WEB-1" }), { refused: true, text: "agent_start is refused: WEB-1 has sub-issues (WEB-2), and a parent has no agent of its own: start agents on them." });

  await text("issue_create", { ...ISSUE, title: "Replay" });
  await text("agent_start", { issue: "WEB-3" });
  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "WEB-3" }), {
    refused: true,
    text: "No issue filed: WEB-4 can't be a sub-issue of WEB-3: a1 holds WEB-3, and a parent has no agent, so WEB-3 can't be split now. Stop a1 with agent_stop first.",
  });
  assert.deepEqual(await call("issue_update", { id: "WEB-2", parent: "WEB-3" }), {
    refused: true,
    text: "WEB-2 can't be a sub-issue of WEB-3: a1 holds WEB-3, and a parent has no agent, so WEB-3 can't be split now. Stop a1 with agent_stop first.",
  });
  assert.equal(kit.store.issues(kit.store.coordinators()[0]?.id ?? assert.fail("no manager")).length, 3);
});

test("4: a parent's dependency blocks its sub-issue, which isn't ready; when it closes, the sub-issue is announced unblocked, once, and the parent never", async () => {
  const { kit, text, board, unblocked } = await managing();
  await text("issue_create", RESEARCH);
  const researcher = threadIn(await text("agent_start", { issue: "WEB-1" }));
  await text("issue_create", { ...ISSUE, title: "Card vault", dependsOn: ["WEB-1"] });
  assert.equal(await text("issue_create", { ...ISSUE, title: "Vault schema", parent: "WEB-2" }), "Filed WEB-3 (build) as a sub-issue of WEB-2 in Todo, blocked by WEB-1 (In progress).");
  await text("issue_create", { ...ISSUE, title: "Vault client", parent: "WEB-2", status: "backlog" });
  assert.match(await board(), /\n {2}- WEB-3 "Vault schema" \(Build; no agent, under WEB-2\): Not started; blocked by WEB-1 \(In progress\)\n/);
  assert.match(await board(), /Ready: none /);
  assert.match(await text("issue_read", { id: "WEB-3" }), /Blocked by WEB-1 \(In progress\)\./);

  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-3 by WEB-1 done", "WEB-4 by WEB-1 done"], "each open sub-issue, Backlog too, as any dependent is; never the parent WEB-2");
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-3 by WEB-1 done", "WEB-4 by WEB-1 done"]);
  assert.match(await board(), /Ready: WEB-3 /);
});

test("5: a parent rolls up: Todo while its sub-issues are, In progress once one is; a flagged sub-issue is listed under its parent and under Needs you", async () => {
  const { kit, text, board, statuses, started } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "WEB-1" });
  await text("issue_create", { ...ISSUE, title: "Replay", parent: "WEB-1" });
  assert.deepEqual(await statuses(), { "WEB-1": "todo", "WEB-2": "todo", "WEB-3": "todo" });
  const agentThreadId = await started("WEB-2");
  assert.deepEqual(await statuses(), { "WEB-1": "in-progress", "WEB-2": "in-progress", "WEB-3": "todo" });

  await kit.call("agent_handoff", { status: "blocked", ...FIELDS, summary: "Needs a staging key" }, agentThreadId);
  await kit.idle(agentThreadId, "Handed off.");
  const blockedRow = `- WEB-2 "Dead letters" (Build; a1, @thread:${agentThreadId}, under WEB-1, on branch \`bb/${agentThreadId}\`): Blocked: Needs a staging key`;
  const lanes = await board();
  assert.ok(lanes.startsWith(`### Needs you (1)\n${blockedRow}\n\n### In progress (1)\n- WEB-1 "Add retries" (Build; parent): 0/2 done\n  ${blockedRow}\n  - WEB-3 `), lanes);
});

test("6: a research parent is Done when its last sub-issue closes; a build parent waits In review once all are merged and is accepted; one accepted unmerged is flagged", async () => {
  const research = await managing();
  await research.text("issue_create", RESEARCH);
  await research.text("issue_create", { ...RESEARCH, title: "Vault", parent: "WEB-1" });
  await research.text("issue_create", { ...RESEARCH, title: "KMS", parent: "WEB-1" });
  await research.text("issue_update", { id: "WEB-3", status: "canceled" });
  const researcher = await research.started("WEB-2");
  await research.kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await research.kit.idle(researcher, "Handed off.");
  assert.deepEqual(await research.statuses(), { "WEB-1": "done", "WEB-2": "done", "WEB-3": "canceled" });

  const build = await managing({ verify: false });
  await build.text("issue_create", ISSUE);
  await build.text("issue_create", { ...ISSUE, title: "Dead letters", parent: "WEB-1" });
  await build.text("issue_create", { ...RESEARCH, parent: "WEB-1" });
  const builder = await build.started("WEB-2");
  const researcher2 = await build.started("WEB-3");
  await build.kit.call("agent_handoff", RESEARCH_DONE, researcher2);
  await build.kit.idle(researcher2, "Handed off.");
  await build.kit.call("agent_handoff", BUILD_DONE, builder);
  await build.kit.idle(builder, "Handed off.");
  assert.deepEqual(await build.call("issue_update", { id: "WEB-1", status: "done" }), { refused: true, text: "WEB-1 is In progress (1/2 done), so it can't be marked Done: only an issue In review can." });

  assert.equal(await build.text("issue_update", { id: "WEB-2", status: "done" }), "Updated WEB-2.");
  const flag = "WEB-2 isn't merged, so WEB-1's work isn't all on the default branch";
  assert.match(await build.board(), new RegExp(`### Needs you \\(1\\)\\n- WEB-1 "Add retries" \\(Build; parent\\): 2/2 done. ${flag}\\n`));

  build.kit.github.prs.set(build.kit.thread(builder).environmentBranchName ?? assert.fail("no branch"), { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  build.kit.clock.now += 10 * 60_000;
  await build.kit.tick();
  assert.deepEqual(await build.statuses(), { "WEB-1": "in-review", "WEB-2": "done", "WEB-3": "done" });
  assert.equal(await build.text("issue_update", { id: "WEB-1", status: "done" }), "Updated WEB-1.");
  assert.deepEqual(await build.statuses(), { "WEB-1": "done", "WEB-2": "done", "WEB-3": "done" });
});

test("7: a parent is canceled only once its sub-issues are closed; every sub-issue canceled leaves it where the manager rested it", async () => {
  const { call, text, statuses } = await managing();
  await text("issue_create", { ...ISSUE, status: "backlog" });
  await text("issue_create", { ...ISSUE, title: "Dead letters", parent: "WEB-1" });
  await text("issue_create", { ...ISSUE, title: "Replay", parent: "WEB-1" });
  await text("issue_update", { id: "WEB-2", status: "canceled" });
  assert.deepEqual(await call("issue_update", { id: "WEB-1", status: "canceled" }), { refused: true, text: "WEB-1 can't be canceled while sub-issues of it are open: WEB-3. Cancel them, or let them finish, first." });

  await text("issue_update", { id: "WEB-3", status: "canceled" });
  assert.deepEqual(await statuses(), { "WEB-1": "backlog", "WEB-2": "canceled", "WEB-3": "canceled" });
  assert.equal(await text("issue_update", { id: "WEB-1", status: "canceled" }), "Updated WEB-1.");
  assert.deepEqual(await statuses(), { "WEB-1": "canceled", "WEB-2": "canceled", "WEB-3": "canceled" });
  assert.deepEqual(await call("issue_create", { ...ISSUE, parent: "WEB-1" }), { refused: true, text: "No issue filed: WEB-4 can't be a sub-issue of WEB-1: WEB-1 is closed. Give WEB-4 no parent, or an open top-level build issue as its parent." });
});

type Manager = Awaited<ReturnType<typeof managing>>;

/**
 * A manager with WEB-1 and WEB-2, an agent on WEB-2, WEB-1 changed as `first` says, then the filing of a
 * sub-issue of WEB-1 held at bb's listing while `meanwhile` writes the manager's act straight to the
 * store: no change is counted, so only the rows the write holds can say it. The filing's result,
 * and every status after.
 */
async function filedUnderI1While(first: object, meanwhile: (store: Manager["kit"]["store"], id: Manager["coordinatorId"]) => void) {
  const { kit, coordinatorId, call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters" });
  await text("agent_start", { issue: "WEB-2" });
  await text("issue_update", { id: "WEB-1", ...first });
  await settled();
  kit.threadLists.holding = true;
  const filing = call("issue_create", { ...ISSUE, title: "Replay", parent: "WEB-1" });
  await settled();
  assert.ok(kit.threadLists.held.length > 0, "no listing held");
  meanwhile(kit.store, coordinatorId);
  await releaseAll(kit.threadLists);
  return { result: await filing, statuses: await statuses() };
}

const I1 = issueIdSchema.parse("WEB-1");

test("filing a sub-issue is judged on its parent as stored when it is written: canceled while bb was read, refused; reopened meanwhile, filed", async () => {
  const canceled = await filedUnderI1While({ title: "Add retries" }, (store, id) => store.updateIssue(id, I1, { closed: { as: "canceled", at: 2_000 } }, { requireUnheld: true, closes: new Map(), at: 3_000 }));
  assert.deepEqual(canceled.result, { refused: true, text: "No issue filed: WEB-3 can't be a sub-issue of WEB-1: WEB-1 is closed. Give WEB-3 no parent, or an open top-level build issue as its parent." });
  assert.deepEqual(canceled.statuses, { "WEB-1": "canceled", "WEB-2": "in-progress" });

  const reopened = await filedUnderI1While({ status: "canceled" }, (store, id) => store.updateIssue(id, I1, { closed: null }, { requireUnheld: true, closes: new Map(), at: 3_000 }));
  assert.deepEqual(reopened.result, { refused: false, text: "Filed WEB-3 (build) as a sub-issue of WEB-1 in Todo." });
});

test("canceling a parent is judged on its sub-issues as they are when it is written: one reopened by a message while bb's turns were read keeps it open", async () => {
  const { kit, call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...RESEARCH, parent: "WEB-1" });
  const researcher = threadIn(await text("agent_start", { issue: "WEB-2" }));
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await statuses(), { "WEB-1": "verifying", "WEB-2": "done" });

  kit.turnEvents.holding = true;
  const canceling = call("issue_update", { id: "WEB-1", status: "canceled" });
  await settled();
  assert.ok(kit.turnEvents.held.length > 0, "no turn read held");
  await text("agent_message", { agent: "a1", text: "Please revise the report." });
  await releaseAll(kit.turnEvents);

  assert.deepEqual(await canceling, { refused: true, text: "WEB-1 can't be canceled while sub-issues of it are open: WEB-2. Cancel them, or let them finish, first." });
  assert.deepEqual(await statuses(), { "WEB-1": "in-progress", "WEB-2": "in-progress" });
});

test("two plan writes whose reads both finished first are judged in turn: a sub-issue moved out closes its research parent, and the filing under that parent read beside it is refused", async () => {
  const { kit, call, text, statuses, started } = await managing();
  await text("issue_create", RESEARCH);
  await text("issue_create", { ...RESEARCH, title: "Vault", parent: "WEB-1" });
  await text("issue_create", { ...RESEARCH, title: "KMS", parent: "WEB-1" });
  const researcher = await started("WEB-2");
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await statuses(), { "WEB-1": "in-progress", "WEB-2": "done", "WEB-3": "todo" });

  kit.turnEvents.holding = true;
  const moving = call("issue_update", { id: "WEB-3", parent: null });
  const filing = call("issue_create", { ...RESEARCH, title: "HSM", parent: "WEB-1" });
  await settled();
  assert.equal(kit.turnEvents.held.length, 2, "both writes' reads held");
  // Both reads answer in one go: the filing's read is done before the move's caller resumes from its write.
  await releaseAll(kit.turnEvents);

  assert.deepEqual(await moving, { refused: false, text: "Updated WEB-3." });
  assert.deepEqual(await filing, { refused: true, text: "No issue filed: WEB-4 can't be a sub-issue of WEB-1: WEB-1 is closed. Give WEB-4 no parent, or an open top-level build or research issue as its parent." });
  assert.deepEqual(await statuses(), { "WEB-1": "done", "WEB-2": "done", "WEB-3": "todo" });
});

test("a plan write whose reads keep being overtaken writes nothing and says to try again", async () => {
  const { kit, call, text, statuses } = await managing();
  await text("issue_create", ISSUE);
  await text("issue_create", { ...ISSUE, title: "Dead letters" });
  await text("agent_start", { issue: "WEB-2" });
  await settled();
  kit.threadLists.holding = true;
  let answered = false;
  const filing = call("issue_create", { ...ISSUE, title: "Replay", parent: "WEB-1" }).finally(() => {
    answered = true;
  });
  // Every bb read answers only after the manager changed something again, as a crew at work keeps doing.
  for (let round = 0; round < 10 && !answered; round++) {
    await settled();
    await text("issue_update", { id: "WEB-2", title: `Dead letters, round ${round}` });
    kit.threadLists.held.splice(0).forEach((release) => release());
  }
  await releaseAll(kit.threadLists);

  assert.deepEqual(await filing, { refused: true, text: "No issue filed: your issues kept changing while they were read, so nothing was written. Try again." });
  assert.deepEqual(await statuses(), { "WEB-1": "todo", "WEB-2": "in-progress" });
  assert.equal(await text("issue_create", { ...ISSUE, title: "Replay", parent: "WEB-1" }), "Filed WEB-3 (build) as a sub-issue of WEB-1 in Todo.");
});

/** A research parent WEB-1 with research sub-issues WEB-2 and WEB-3, WEB-4 depending on WEB-1, and one more research sub-issue per `more`, filed WEB-5 on. */
async function researchFamily(more = 0) {
  const manager = await managing();
  await manager.text("issue_create", RESEARCH);
  await manager.text("issue_create", { ...RESEARCH, title: "Vault", parent: "WEB-1" });
  await manager.text("issue_create", { ...RESEARCH, title: "KMS", parent: "WEB-1" });
  await manager.text("issue_create", { ...ISSUE, title: "Card vault schema", dependsOn: ["WEB-1"] });
  for (let n = 0; n < more; n++) await manager.text("issue_create", { ...RESEARCH, title: `Option ${n + 1}`, parent: "WEB-1" });
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
  const researcher = await started("WEB-2");
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await settled();
  assert.equal(await text("issue_update", { id: "WEB-3", status: "canceled" }), "Updated WEB-3.");
  assert.deepEqual(await statuses(), { "WEB-1": "in-progress", "WEB-2": "in-progress", "WEB-3": "canceled", "WEB-4": "todo" });

  await kit.idle(researcher, "Handed off.");
  await settled();
  assert.deepEqual(await statuses(), { "WEB-1": "done", "WEB-2": "done", "WEB-3": "canceled", "WEB-4": "todo" });
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done"]);
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done"]);
});

test("moving a canceled or a Done sub-issue out of a Done research parent wakes nobody; the manager's cancel that closed it wakes its dependent at most once beside its own result", async () => {
  const { text, statuses, started, report, unblocked } = await researchFamily(1);
  await report(await started("WEB-2"));
  await report(await started("WEB-3"));
  assert.deepEqual(await unblocked(), []);
  // The manager's own act is the step that closes WEB-1: its result says what became ready, and one wake may say it again.
  assert.equal(await text("issue_update", { id: "WEB-5", status: "canceled" }), "Updated WEB-5. Now ready: WEB-4.");
  await settled();
  const woken = await unblocked();
  assert.ok(woken.length <= 1, woken.join("; "));

  assert.equal(await text("issue_update", { id: "WEB-5", parent: null }), "Updated WEB-5.");
  await settled();
  assert.equal(await text("issue_update", { id: "WEB-3", parent: null }), "Updated WEB-3.");
  await settled();
  assert.deepEqual(await statuses(), { "WEB-1": "done", "WEB-2": "done", "WEB-3": "done", "WEB-4": "todo", "WEB-5": "canceled" });
  assert.deepEqual(await unblocked(), woken);
});

test("a research parent's sub-issue reopened by a message and reported again wakes the parent's dependents again, once", async () => {
  const { kit, text, statuses, started, report, unblocked } = await researchFamily();
  const researcher = await started("WEB-2");
  await report(researcher);
  await report(await started("WEB-3"));
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done"]);

  await text("agent_message", { agent: "a1", text: "Add what KMS would cost." });
  await settled();
  assert.deepEqual(await statuses(), { "WEB-1": "in-progress", "WEB-2": "in-progress", "WEB-3": "done", "WEB-4": "todo" });
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done"]);
  await report(researcher);
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done", "WEB-4 by WEB-1 done"]);
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done", "WEB-4 by WEB-1 done"]);
});

test("a research parent's last two sub-issues closing together wake its dependents once", async () => {
  const { kit, started, unblocked } = await researchFamily();
  const one = await started("WEB-2");
  const two = await started("WEB-3");
  await kit.call("agent_handoff", RESEARCH_DONE, one);
  await kit.call("agent_handoff", RESEARCH_DONE, two);
  kit.threadLists.holding = true;
  await Promise.all([kit.idle(one, "Handed off."), kit.idle(two, "Handed off.")]);
  await releaseAll(kit.threadLists);
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done"]);
  await kit.tick();
  await settled();
  assert.deepEqual(await unblocked(), ["WEB-4 by WEB-1 done"]);
});

test("the board's rows carry each issue's parent and a parent's count of Done sub-issues, and what it blocks, and nothing else new", async () => {
  const { kit, coordinatorId, text, started } = await managing();
  await text("issue_create", RESEARCH);
  await text("issue_create", { ...RESEARCH, title: "Vault", parent: "WEB-1" });
  const rows = async () => (await kit.rpc.board({ coordinatorId })).issues;
  const unstarted = { needsYou: null, agent: null, pr: null };
  assert.deepEqual(await rows(), [
    { id: "WEB-1", kind: "research", parentId: null, subIssues: { done: 0, total: 1 }, blockedBy: [], blocks: [], title: "Pick a card vault", status: "todo", headline: null, ...unstarted },
    { id: "WEB-2", kind: "research", parentId: "WEB-1", subIssues: null, blockedBy: [], blocks: [], title: "Vault", status: "todo", headline: "Not started", ...unstarted },
  ]);

  const researcher = await started("WEB-2");
  await kit.call("agent_handoff", RESEARCH_DONE, researcher);
  await kit.idle(researcher, "Handed off.");
  assert.deepEqual(await rows(), [
    { id: "WEB-1", kind: "research", parentId: null, subIssues: { done: 1, total: 1 }, blockedBy: [], blocks: [], title: "Pick a card vault", status: "done", headline: null, ...unstarted },
    {
      id: "WEB-2",
      kind: "research",
      parentId: "WEB-1",
      subIssues: null,
      blockedBy: [],
      blocks: [],
      title: "Vault",
      status: "done",
      needsYou: null,
      headline: "Handed off: Vault fits our PCI scope",
      agent: { id: "a1", threadId: researcher },
      pr: null,
    },
  ]);
});

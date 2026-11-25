// What another plugin reads of a board's open work (`openIssues`) agrees with the board it is read
// beside: the same issues, with the same statuses and reasons, under Needs you and under way.
import assert from "node:assert/strict";
import { test } from "node:test";
import { publishedContract } from "../../contract.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { coordinating, HEAD, ISSUE, startedAgent, textOf } from "../test-harness.ts";

const REPORT = { summary: "Done", did: [], evidence: [], concerns: [], deviations: [], findings: [] };

/** A manager with an issue in each place the open work reads, and one in a place it leaves out. */
async function busyBoard() {
  const started = await coordinating();
  const { kit, threadId } = started;
  const file = async (input: object) => textOf(await kit.call("issue_create", { ...ISSUE, ...input }, threadId));
  await startedAgent(kit, threadId, { title: "Retry budget" }); // WEB-1: working
  const reviewed = await startedAgent(kit, threadId, { title: "Retry queue" }); // WEB-2: handed off, reviewing
  await kit.call("agent_handoff", { ...REPORT, status: "done", headSha: HEAD }, reviewed.agentThreadId);
  kit.thread(reviewed.agentThreadId).status = "idle";
  const blocked = await startedAgent(kit, threadId, { title: "Dead letters" }); // WEB-3: blocked
  await kit.call("agent_handoff", { ...REPORT, status: "blocked" }, blocked.agentThreadId);
  kit.thread(blocked.agentThreadId).status = "idle";
  await file({ title: "Webhook schema" }); // WEB-4: todo, its sub-issue asked about
  await file({ title: "Schema version", parent: "WEB-4" }); // WEB-5
  await kit.call("crew_ask_user", { question: "Keep v1 fields?", options: [], issue: "WEB-5" }, threadId);
  await kit.call("crew_ask_user", { question: "Ship on Friday?", options: [] }, threadId);
  await file({ title: "Backoff docs" }); // WEB-6: todo, left out
  return started;
}

test("openIssues lists the board's Needs you and its work under way, with the board's own statuses and reasons", async () => {
  const { kit, coordinatorId } = await busyBoard();
  const board = await kit.rpc.board({ coordinatorId });
  const work = publishedContract.openIssues.output.parse(await kit.rpc.openIssues({ keys: [coordinatorId] }))[coordinatorId] ?? assert.fail("no open work read");
  const rows = new Map(board.issues.map((row) => [row.id, row]));

  assert.deepEqual(
    work.needsYou.map(({ id }) => id),
    ["WEB-3", "WEB-5"],
    "the blocked issue, and the sub-issue asked about, flagged itself",
  );
  assert.deepEqual(
    work.needsYou.map(({ id, status, reason, parentId }) => [id, status, reason, parentId]),
    board.issues.filter((row) => row.needsYou !== null).map(({ id, status, needsYou, parentId }) => [id, status, needsYou, parentId]),
    "Needs you is the board's, each with its status and reason",
  );
  assert.deepEqual(
    work.underWay.map(({ id, status }) => [id, status]),
    [
      ["WEB-2", "reviewing"],
      ["WEB-1", "in-progress"],
    ],
    "under way: Reviewing before In progress, as the board orders them",
  );
  for (const { id, status, title } of [...work.needsYou, ...work.underWay]) assert.deepEqual([status, title], [rows.get(id)?.status, rows.get(id)?.title], `${id} reads as on the board`);
  assert.deepEqual(work.parents, [{ id: "WEB-4", title: "Webhook schema", status: "todo" }], "a listed sub-issue's parent, listed nowhere itself");
  assert.deepEqual(
    work.decisions.map(({ question }) => question),
    ["Ship on Friday?"],
    "only the decision naming no listed issue",
  );
});

test("a manager's open work is empty when it has none, or is unknown, rather than refused", async () => {
  const { kit, coordinatorId } = await coordinating();
  const unknown = coordinatorIdSchema.parse("00000000-0000-4000-8000-000000000000");
  const empty = { needsYou: [], underWay: [], parents: [], decisions: [] };
  assert.deepEqual(await kit.rpc.openIssues({ keys: [coordinatorId, unknown] }), { [coordinatorId]: empty, [unknown]: empty });
});

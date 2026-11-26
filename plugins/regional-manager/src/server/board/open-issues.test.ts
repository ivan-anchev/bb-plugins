// What another plugin reads of a board's open work (`openIssues`) agrees with the board it is read
// beside: the same issues, with the same statuses and reasons, under Needs you and under way.
import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinatorIdSchema } from "../../model/role.ts";
import { memoryStorage } from "../memory-storage.ts";
import { askedOnNoIssue } from "../store/test-store.ts";
import { coordinating, HEAD, ISSUE, settled, startedAgent, textOf, toCap } from "../test-harness.ts";

const REPORT = { summary: "Done", did: [], evidence: [], concerns: [], deviations: [], findings: [] };

/**
 * A manager with an issue in each place the open work reads, and in places it leaves out: working,
 * reviewing, verifying, blocked, a parent in Todo with a sub-issue asked about, a decision on no
 * issue; in review, and in Todo.
 */
async function busyBoard() {
  const { storage } = memoryStorage();
  const started = await coordinating({ storage });
  const { kit, threadId, coordinatorId } = started;
  const file = async (input: object) => textOf(await kit.call("issue_create", { ...ISSUE, ...input }, threadId));
  const handedOff = async (title: string, status: "done" | "blocked") => {
    const { agentThreadId } = await startedAgent(kit, threadId, { title });
    await kit.call("agent_handoff", { ...REPORT, status, ...(status === "done" ? { headSha: HEAD } : {}) }, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
    await settled();
  };
  await startedAgent(kit, threadId, { title: "Retry budget" }); // WEB-1: working
  kit.reviewers.reportAtOnce = false;
  await handedOff("Retry queue", "done"); // WEB-2: its review running
  kit.reviewers.reportAtOnce = true;
  await handedOff("Retry jitter", "done"); // WEB-3: reviewed, its verifier running
  await handedOff("Dead letters", "blocked"); // WEB-4
  await file({ title: "Webhook schema" }); // WEB-5: todo, its sub-issue asked about
  await file({ title: "Schema version", parent: "WEB-5" }); // WEB-6
  await kit.call("crew_ask_user", { question: "Keep v1 fields?", options: [], issue: "WEB-6" }, threadId);
  askedOnNoIssue(storage, coordinatorId, "Ship on Friday?", [], 1_000);
  await kit.rpc.setVerify({ coordinatorId, verify: false });
  await handedOff("Retry metrics", "done"); // WEB-7: in review, unverified
  await file({ title: "Backoff docs" }); // WEB-8: todo
  return started;
}

test("openIssues lists the board's Needs you and its work under way, with the board's own statuses and reasons", async () => {
  const { kit, coordinatorId } = await busyBoard();
  const board = await kit.rpc.board({ coordinatorId });
  // why unparsed: the contract's schema would drop a field the handler sends and the card never reads.
  const work = (await kit.rpc.openIssues({ keys: [coordinatorId] }))[coordinatorId] ?? assert.fail("no open work read");
  const rows = new Map(board.issues.map((row) => [row.id, row]));
  const keysOf = (items: readonly object[]) => [...new Set(items.map((item) => Object.keys(item).sort().join(",")))];

  assert.deepEqual(Object.keys(work).sort(), ["decisions", "needsYou", "parents", "underWay"], "it sends only what another plugin's card reads");
  assert.deepEqual(keysOf(work.needsYou), ["id,parentId,reason,status,title"]);
  assert.deepEqual(keysOf(work.underWay), ["id,parentId,status,title"]);
  assert.deepEqual(keysOf(work.parents), ["id,status,title"]);
  assert.deepEqual(keysOf(work.decisions), ["id,question"]);

  assert.deepEqual(
    work.needsYou.map(({ id }) => id),
    ["WEB-4", "WEB-6"],
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
      ["WEB-3", "verifying"],
      ["WEB-2", "reviewing"],
      ["WEB-1", "in-progress"],
    ],
    "under way: Verifying, Reviewing, then In progress, as the board orders them; In review and Todo left out",
  );
  for (const { id, status, title } of [...work.needsYou, ...work.underWay]) assert.deepEqual([status, title], [rows.get(id)?.status, rows.get(id)?.title], `${id} reads as on the board`);
  assert.deepEqual(
    board.issues.filter(({ id }) => id === "WEB-7" || id === "WEB-8").map(({ id, status }) => [id, status]),
    [
      ["WEB-7", "in-review"],
      ["WEB-8", "todo"],
    ],
    "the issues left out are on the board, In review and Todo",
  );
  assert.deepEqual(work.parents, [{ id: "WEB-5", title: "Webhook schema", status: "todo" }], "a listed sub-issue's parent, listed nowhere itself");
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

test("openIssues lists an issue at its cap under Needs you, its reason led by the cap, and drops its question once the issue is canceled, as the board does", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { agentThreadId } = await startedAgent(kit, threadId);
  await toCap(kit, threadId, coordinatorId, "WEB-1", agentThreadId);
  const work = async () => (await kit.rpc.openIssues({ keys: [coordinatorId] }))[coordinatorId] ?? assert.fail("no open work read");

  const capped = await work();
  assert.deepEqual(capped.needsYou.map(({ id, reason }) => [id, reason]), [["WEB-1", "At its cap of 3 failed verifications: ✗ Failed verification: Retries land with backoff"]]);
  assert.deepEqual(capped.decisions, [], "its question names a listed issue");

  await kit.call("agent_stop", { agent: "a2" }, threadId);
  assert.ok(!textOf(await kit.call("issue_update", { id: "WEB-1", status: "canceled" }, threadId)).includes("refused"));
  assert.deepEqual(await work(), { needsYou: [], underWay: [], parents: [], decisions: [] }, "the canceled issue's question no longer waits, here or on the board");
  assert.deepEqual((await kit.rpc.board({ coordinatorId })).decisions.map(({ id, answer }) => [id, answer]), [["d1", null]], "nothing was written: it is still unanswered");
});

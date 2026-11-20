import assert from "node:assert/strict";
import { test } from "node:test";
import { needsYouBadge } from "../../app/needs-you-label.ts";
import { boardTag, coordinatorContract } from "../../contract.ts";
import { boardGroups, laneOf } from "../../model/board/board-groups.ts";
import { decisionIdSchema } from "../../model/decision.ts";
import { DISPLAY_NAME } from "../../name.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { coordinating, ISSUE, isRefusal, settled, startedAgent, textOf } from "../test-harness.ts";

const QUESTION = "Target main or release/2?";
const d1 = decisionIdSchema.parse("d1");

/** The board as the app reads it: bb parses each RPC's result with its contract. */
async function boardOf(kit: Awaited<ReturnType<typeof coordinating>>["kit"], coordinatorId: CoordinatorId) {
  return coordinatorContract.board.output.parse(await kit.rpc.board({ coordinatorId }));
}

/** A Coordinator that asked the user QUESTION with two options, its thread idle so a doorbell starts a turn. */
async function asked() {
  const started = await coordinating({ verify: false });
  const { kit, threadId } = started;
  const answer = textOf(await kit.call("crew_ask_user", { question: QUESTION, options: ["main", "release/2"] }, threadId));
  kit.thread(threadId).status = "idle";
  return {
    ...started,
    answer,
    /** Every doorbell that reached the Coordinator, in order. */
    doorbells: () => kit.delivered(threadId).filter((text) => text.startsWith(`[${DISPLAY_NAME}]`)),
  };
}

test("crew_ask_user returns at once, and the decision waits on the board under Needs you with its options", async () => {
  const { kit, coordinatorId, answer, doorbells } = await asked();
  assert.equal(answer, "Asked the user d1 on their board, under Needs you. Carry on with other work, or end your turn: their answer wakes you, and crew_catch_up returns it.");

  const board = await boardOf(kit, coordinatorId);
  assert.deepEqual(
    board.decisions.map((decision) => ({ id: decision.id, question: decision.question, options: decision.options, given: decision.answer })),
    [{ id: d1, question: QUESTION, options: ["main", "release/2"], given: null }],
  );
  assert.deepEqual(boardGroups(board.decisions, board.issues).map(({ lane, rows }) => [lane, rows.length]), [["needs-you", 1]]);
  assert.ok(kit.invalidated().includes(boardTag(coordinatorId)), "the board reads it again");
  assert.deepEqual(await kit.rpc.needsYou({ keys: [coordinatorId] }), { [coordinatorId]: { decisions: 1, issues: 0 } });
  assert.deepEqual(doorbells(), [], "asking wakes nobody");
});

test("while a decision waits for the user, an agent's handoff still wakes the regional manager", async () => {
  const { kit, threadId, doorbells } = await asked();
  kit.thread(threadId).status = "active";
  const agentThreadId = (await startedAgent(kit, threadId, { title: "Add retries", brief: "Do it." })).agentThreadId;
  kit.thread(threadId).status = "idle";

  await kit.call("agent_handoff", { status: "blocked", summary: "Needs a staging key", did: [], evidence: [], concerns: [], deviations: [], findings: [] }, agentThreadId);
  await settled();

  assert.deepEqual(doorbells(), [`[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- i1 "Add retries" (a1) handed off: blocked`]);
});

test("an answer wakes the Coordinator with its own question, and crew_catch_up returns the question and the answer", async () => {
  const { kit, threadId, coordinatorId, doorbells } = await asked();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "release/2" });
  await settled();

  assert.deepEqual(doorbells(), [`[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- The user answered your question d1: ${QUESTION}`]);
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(caughtUp, /### The user answered your question d1\n\nAt \S+ You asked: Target main or release\/2\? You offered: "main", "release\/2"\. They chose "release\/2"\./);
  assert.match(caughtUp, /## Decisions\n\nNone waiting for the user\./);

  const board = await boardOf(kit, coordinatorId);
  assert.deepEqual(boardGroups(board.decisions, board.issues).map(({ lane, rows }) => [lane, rows.length]), [["done", 1]]);
  assert.equal(board.decisions[0]?.answer?.text, "release/2");
  assert.deepEqual(await kit.rpc.needsYou({ keys: [coordinatorId] }), { [coordinatorId]: { decisions: 0, issues: 0 } }, "the badge drops it");
});

test("the badge counts what each board shows under Needs you: open decisions, and issues blocked, waiting in their thread or failed", async () => {
  const { kit, threadId, coordinatorId } = await asked();
  await kit.call("crew_ask_user", { question: "Ship on Friday?", options: [] }, threadId);
  await kit.rpc.answerDecision({ coordinatorId, decisionId: decisionIdSchema.parse("d2"), answer: "No" });
  const agents = [];
  for (const title of ["Blocked", "Asking", "Failing", "Running", "Stopped"]) agents.push((await startedAgent(kit, threadId, { title, brief: "Do it." })).agentThreadId);
  const [blocked = "", asking = "", failing = ""] = agents;
  await kit.call("agent_handoff", { status: "blocked", summary: "Needs a staging key", did: [], evidence: [], concerns: [], deviations: [], findings: [] }, blocked);
  kit.thread(blocked).status = "idle";
  kit.thread(asking).hasPendingInteraction = true;
  kit.thread(failing).status = "error";
  await kit.call("agent_stop", { agent: "a5" }, threadId);
  const { threadId: otherThread } = await kit.startManager("Ship the billing export", { verify: false });
  const other = kit.store.roleOfThread(otherThread);
  assert.equal(other?.kind, "coordinator");

  /** The ids under Needs you, as the board draws its lanes. */
  const drawn = async (id: CoordinatorId) => {
    const board = await boardOf(kit, id);
    const lane = boardGroups(board.decisions, board.issues).find(({ lane }) => lane === "needs-you")?.rows ?? [];
    return lane.map((item) => (item.kind === "decision" ? item.decision.id : item.issue.id));
  };
  assert.deepEqual(await drawn(coordinatorId), ["d1", "i1", "i2", "i3"]);
  assert.deepEqual(await drawn(other.coordinatorId), []);

  const counts = await kit.rpc.needsYou({ keys: [coordinatorId, other.coordinatorId] });
  assert.deepEqual(counts, { [coordinatorId]: { decisions: 1, issues: 3 }, [other.coordinatorId]: { decisions: 0, issues: 0 } });
  assert.deepEqual(needsYouBadge(Object.values(counts)), { count: 4, tone: "critical", label: "4 need you: 1 decision, 3 issues" });

  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "main" });
  assert.deepEqual(await drawn(coordinatorId), ["i1", "i2", "i3"]);
  assert.deepEqual(needsYouBadge(Object.values(await kit.rpc.needsYou({ keys: [coordinatorId, other.coordinatorId] }))), { count: 3, tone: "critical", label: "3 need you: 3 issues" });
});

test("a question about an issue flags it Needs you until the user answers, and the badge counts the decision and the issue", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  await kit.call("issue_create", { ...ISSUE, status: "backlog" }, threadId);
  assert.match(textOf(await kit.call("crew_ask_user", { question: "Start i1 now?", options: ["Yes", "Not yet"], issue: "i1" }, threadId)), /^Asked the user d1/);

  const board = await boardOf(kit, coordinatorId);
  assert.deepEqual(board.issues.map((issue) => [issue.id, laneOf(issue), issue.headline]), [["i1", "needs-you", "Not planned"]]);
  assert.deepEqual(board.decisions.map(({ id, issueId }) => [id, issueId]), [["d1", "i1"]]);
  assert.deepEqual(needsYouBadge(Object.values(await kit.rpc.needsYou({ keys: [coordinatorId] }))), { count: 2, tone: "critical", label: "2 need you: 1 decision, 1 issue" });

  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "Yes" });
  assert.deepEqual((await boardOf(kit, coordinatorId)).issues.map(laneOf), ["backlog"]);
  assert.equal(needsYouBadge(Object.values(await kit.rpc.needsYou({ keys: [coordinatorId] }))), null);

  const unknown = await kit.call("crew_ask_user", { question: "Start i9?", issue: "i9" }, threadId);
  assert.ok(isRefusal(unknown));
  assert.equal(textOf(unknown), "You have no issue i9. crew_catch_up lists your issues.");
});

test("the badge names one waiting decision in the singular, and shows nothing when nothing waits", () => {
  assert.deepEqual(needsYouBadge([{ decisions: 1, issues: 0 }]), { count: 1, tone: "critical", label: "1 needs you: 1 decision" });
  assert.equal(needsYouBadge([{ decisions: 0, issues: 0 }]), null);
  assert.equal(needsYouBadge([]), null);
});

test("an answer in the user's own words reaches crew_catch_up whole, and never the doorbell", async () => {
  const { kit, threadId, coordinatorId, doorbells } = await asked();
  const theirs = "Neither yet.\nAsk me again after the freeze.";
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: theirs });
  await settled();

  assert.ok(doorbells().every((text) => !text.includes("freeze")));
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /You offered: "main", "release\/2"\. Their answer, in their own words:\n\nNeither yet\.\nAsk me again after the freeze\./);
});

test("a decision is answered once: a second answer is refused, and the first stands and wakes once", async () => {
  const { kit, coordinatorId, doorbells } = await asked();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "main" });
  await assert.rejects(async () => kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "release/2" }), { code: "conflict", message: "d1 was already answered; an answer can't be changed." });
  await settled();

  assert.equal((await kit.rpc.board({ coordinatorId })).decisions[0]?.answer?.text, "main");
  assert.equal(doorbells().length, 1);
});

test("only the Coordinator that asked can be answered: another's decision is refused as unknown", async () => {
  const { kit, coordinatorId } = await asked();
  const { threadId: theirs } = await kit.startManager("Ship the billing export", { verify: false });
  const role = kit.store.roleOfThread(theirs);
  assert.equal(role?.kind, "coordinator");
  const other = role.coordinatorId;

  await assert.rejects(async () => kit.rpc.answerDecision({ coordinatorId: other, decisionId: d1, answer: "main" }), { code: "not_found" });
  assert.equal((await kit.rpc.board({ coordinatorId })).decisions[0]?.answer, null);
});

test("crew_ask_user refuses more than five options, two alike or a question on two lines, and asks nothing", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  for (const input of [
    { question: QUESTION, options: ["a", "b", "c", "d", "e", "f"] },
    { question: QUESTION, options: ["main", "main"] },
    { question: "Target main\nor release/2?", options: [] },
  ]) {
    await assert.rejects(kit.call("crew_ask_user", input, threadId));
  }
  assert.deepEqual(kit.store.decisions(coordinatorId), []);
});

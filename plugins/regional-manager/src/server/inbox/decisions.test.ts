import assert from "node:assert/strict";
import { test } from "node:test";
import { needsYouBadge } from "../../app/needs-you-label.ts";
import { boardTag, coordinatorContract, issueTag } from "../../contract.ts";
import { boardGroups, laneOf } from "../../model/board/board-groups.ts";
import { decisionIdSchema } from "../../model/decision.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { coordinating, doorbellOf, newSubmission, failsVerification, HEAD, isRefusal, ISSUE, settled, startedAgent, textOf, threadIn, toCap, holdingThreadLists, turnsUntil } from "../test-harness.ts";

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
    doorbells: () => kit.doorbellsDelivered(threadId),
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

  assert.deepEqual(doorbells(), [doorbellOf(`WEB-1 "Add retries" (a1) handed off: blocked`)]);
});

test("an answer wakes the Coordinator with its own question, and crew_catch_up returns the question and the answer", async () => {
  const { kit, threadId, coordinatorId, doorbells } = await asked();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "release/2" });
  await settled();

  assert.deepEqual(doorbells(), [doorbellOf(`The user answered your question d1: ${QUESTION}`)]);
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(caughtUp, /### The user answered your question d1\n\nAt \S+ You asked: Target main or release\/2\? You offered: "main", "release\/2"\. They chose "release\/2"\./);
  assert.match(caughtUp, /## Decisions\n\nNone waiting for the user\./);

  const board = await boardOf(kit, coordinatorId);
  assert.deepEqual(boardGroups(board.decisions, board.issues), [], "answered, it is on no lane");
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
  assert.deepEqual(await drawn(coordinatorId), ["d1", "WEB-1", "WEB-2", "WEB-3"]);
  assert.deepEqual(await drawn(other.coordinatorId), []);

  const counts = await kit.rpc.needsYou({ keys: [coordinatorId, other.coordinatorId] });
  assert.deepEqual(counts, { [coordinatorId]: { decisions: 1, issues: 3 }, [other.coordinatorId]: { decisions: 0, issues: 0 } });
  assert.deepEqual(needsYouBadge(Object.values(counts)), { count: 4, tone: "critical", label: "4 need you: 1 decision, 3 issues" });

  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "main" });
  assert.deepEqual(await drawn(coordinatorId), ["WEB-1", "WEB-2", "WEB-3"]);
  assert.deepEqual(needsYouBadge(Object.values(await kit.rpc.needsYou({ keys: [coordinatorId, other.coordinatorId] }))), { count: 3, tone: "critical", label: "3 need you: 3 issues" });
});

test("a question about an issue flags it Needs you until the user answers, and the badge counts the decision and the issue", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  await kit.call("issue_create", { ...ISSUE, status: "backlog" }, threadId);
  assert.match(textOf(await kit.call("crew_ask_user", { question: "Start WEB-1 now?", options: ["Yes", "Not yet"], issue: "WEB-1" }, threadId)), /^Asked the user d1/);

  const board = await boardOf(kit, coordinatorId);
  assert.deepEqual(board.issues.map((issue) => [issue.id, laneOf(issue), issue.headline]), [["WEB-1", "needs-you", "Not planned"]]);
  assert.deepEqual(board.decisions.map(({ id, issueId }) => [id, issueId]), [["d1", "WEB-1"]]);
  assert.deepEqual(needsYouBadge(Object.values(await kit.rpc.needsYou({ keys: [coordinatorId] }))), { count: 2, tone: "critical", label: "2 need you: 1 decision, 1 issue" });

  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "Yes" });
  assert.deepEqual((await boardOf(kit, coordinatorId)).issues.map(laneOf), ["backlog"]);
  assert.equal(needsYouBadge(Object.values(await kit.rpc.needsYou({ keys: [coordinatorId] }))), null);

  const read = textOf(await kit.call("issue_read", { id: "WEB-1" }, threadId));
  assert.match(read, /### Decisions\n\n[^#]*- \S+: asked the user \(d1\): Start WEB-1 now\? They answered at \S+: Yes$/m, "answered, it stays among the issue's decisions");
  const feed = await kit.rpc.issueFeed({ coordinatorId, issueId: issueIdSchema.parse("WEB-1") });
  const asked = feed.entries.flatMap((entry) => (entry.kind === "decision" && entry.decision.kind === "asked" ? [entry.decision] : []));
  assert.deepEqual(asked.map(({ id, question, answer }) => [id, question, answer?.text]), [["d1", "Start WEB-1 now?", "Yes"]], "and in its feed");

  const unknown = await kit.call("crew_ask_user", { question: "Start WEB-9?", issue: "WEB-9" }, threadId);
  assert.ok(isRefusal(unknown));
  assert.equal(textOf(unknown), "You have no issue WEB-9. crew_catch_up lists your issues.");
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

test("a question about an issue reads that issue's open tab again at once, and no other issue's", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  await kit.call("issue_create", { ...ISSUE, status: "backlog" }, threadId);
  await kit.call("issue_create", { ...ISSUE, title: "Dead letters", status: "backlog" }, threadId);
  const before = kit.invalidated().length;
  await kit.call("crew_ask_user", { question: "Start WEB-1 now?", options: ["Yes", "Not yet"], issue: "WEB-1" }, threadId);
  const tags = kit.invalidated().slice(before).filter((tag) => tag.startsWith("issue:"));
  assert.deepEqual(tags, [issueTag(coordinatorId, issueIdSchema.parse("WEB-1"))]);
});

test("a cap question whose issue's pull request merged leaves Needs you, on the board and in the needsYou count, while one on an open issue stays; the board sends each question's cap", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  for (const title of ["Add retries", "Dead letters"]) {
    const { issue, agentThreadId } = await startedAgent(kit, threadId, { title });
    await toCap(kit, threadId, coordinatorId, issue, agentThreadId);
  }
  const needsYouLane = async () => {
    const board = await boardOf(kit, coordinatorId);
    const lane = boardGroups(board.decisions, board.issues).find(({ lane: name }) => name === "needs-you")?.rows ?? [];
    return lane.map((row) => (row.kind === "decision" ? `${row.decision.id} ${row.decision.issueId}` : row.issue.id));
  };
  const counted = async () => (await kit.rpc.needsYou({ keys: [coordinatorId] }))[coordinatorId];
  assert.deepEqual(await needsYouLane(), ["d1 WEB-1", "d2 WEB-2", "WEB-1", "WEB-2"]);
  assert.deepEqual(await counted(), { decisions: 2, issues: 2 });
  // why the RPC's own answer, unparsed: a parse would drop a key the payload must not carry.
  const raw = await kit.rpc.board({ coordinatorId });
  assert.deepStrictEqual(raw.decisions.map((decision) => Object.keys(decision).sort()), [0, 1].map(() => ["answer", "askedAt", "cap", "id", "issueId", "options", "question"]));
  assert.deepStrictEqual(raw.decisions.map(({ cap }) => cap), [3, 3]);

  const web1 = kit.store.agents(coordinatorId).find(({ issueId, ended }) => issueId === "WEB-1" && ended === null) ?? assert.fail("no holder");
  const branch = kit.thread(web1.threadId ?? assert.fail("no thread")).environmentBranchName ?? assert.fail("no branch");
  kit.github.prs.set(branch, { number: 41, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  kit.clock.now += 60_000;
  await kit.tick();
  await settled();

  assert.equal((await boardOf(kit, coordinatorId)).issues.find(({ id }) => id === "WEB-1")?.status, "done");
  assert.deepEqual(await needsYouLane(), ["d2 WEB-2", "WEB-2"], "WEB-1's question is on no lane; WEB-2's stays");
  assert.deepEqual(await counted(), { decisions: 1, issues: 1 });
  assert.equal(kit.store.decision(d1)?.answer, null, "nothing was written: the question is still unanswered");
});

test("a cap question asked while the board's host read is held arrives with its issue's reason: the badge counts the question and the issue from one read, as the board shows them", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await failsVerification(kit, coordinatorId, agentThreadId);
  await failsVerification(kit, coordinatorId, agentThreadId);
  const fresh = threadIn(textOf(await kit.call("agent_start", { issue }, threadId)));
  await kit.call("agent_handoff", { status: "done", summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: HEAD }, fresh);
  await kit.idle(fresh, "Handed off.");
  await settled();
  const a2 = kit.store.agents(coordinatorId).find(({ threadId: agentThread }) => agentThread === fresh) ?? assert.fail("no a2");
  const third = kit.store.latestHandoff(coordinatorId, a2.id)?.check ?? assert.fail("no check");
  const running = third.verdict.state === "running" ? third.verdict : assert.fail(`the verdict is ${third.verdict.state}`);
  const checkout = running.checkout ?? assert.fail("no checkout");

  kit.threadLists.holding = true;
  const badge = kit.rpc.needsYou({ keys: [coordinatorId] });
  await settled();
  // The third verdict returns and settles while the badge's host read is held, asking the user.
  kit.store.receiveVerdict(third.id, { state: "returned", verifierThreadId: running.verifierThreadId, headSha: HEAD, checkout, criteria: [{ criterion: "npm test passes", result: "fail", shows: "Ran it.", evidence: "# fail 1" }], blocking: [], findings: [], triage: [], model: { providerId: "codex", model: "gpt-default" }, sameModel: false }, Date.now());
  kit.store.settleReturned(third.id, { kind: "checked", refused: null, ci: { kind: "none" } }, Date.now(), null);
  kit.threadLists.holding = false;
  for (const release of kit.threadLists.held.splice(0)) release();

  assert.deepStrictEqual((await badge)[coordinatorId], { decisions: 1, issues: 1 }, "the question and its issue, never one without the other");
  const board = await kit.rpc.board({ coordinatorId });
  assert.deepStrictEqual([board.decisions.length, board.issues.map(({ needsYou }) => needsYou)], [1, ["At its cap of 3 failed verifications: ✗ Failed verification: Retries land with backoff"]]);
});

test("a failure that asks at the cap while crew_catch_up's host read is held waits for the next catch-up, which tells it with its question and the lock", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await failsVerification(kit, coordinatorId, agentThreadId);
  await failsVerification(kit, coordinatorId, agentThreadId);
  const fresh = threadIn(textOf(await kit.call("agent_start", { issue }, threadId)));
  await kit.call("agent_handoff", { status: "done", summary: "Retries land with backoff", did: [], evidence: [], concerns: [], deviations: [], findings: [], headSha: HEAD }, fresh);
  await kit.idle(fresh, "Handed off.");
  await settled();
  const a2 = kit.store.agents(coordinatorId).find(({ threadId: agentThread }) => agentThread === fresh) ?? assert.fail("no a2");
  const third = kit.store.latestHandoff(coordinatorId, a2.id)?.check ?? assert.fail("no check");
  const running = third.verdict.state === "running" ? third.verdict : assert.fail(`the verdict is ${third.verdict.state}`);
  const checkout = running.checkout ?? assert.fail("no checkout");

  kit.turnEvents.holding = true;
  const caughtUp = kit.call("crew_catch_up", {}, threadId);
  while (kit.turnEvents.held.length === 0) await new Promise((resolve) => setImmediate(resolve));
  // The third verdict returns and settles while catch-up reads a2's turns, asking the user.
  kit.store.receiveVerdict(third.id, { state: "returned", verifierThreadId: running.verifierThreadId, headSha: HEAD, checkout, criteria: [{ criterion: "npm test passes", result: "fail", shows: "Ran it.", evidence: "# fail 1" }], blocking: [], findings: [], triage: [], model: { providerId: "codex", model: "gpt-default" }, sameModel: false }, Date.now());
  kit.store.settleReturned(third.id, { kind: "checked", refused: null, ci: { kind: "none" } }, Date.now(), null);
  kit.turnEvents.holding = false;
  for (const release of kit.turnEvents.held.splice(0)) release();

  const first = textOf(await caughtUp);
  assert.doesNotMatch(first, /\bd1\b/, "neither the failure that asked nor its question: both are newer than this catch-up's read");
  const next = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.match(next, /This was WEB-1's 3rd failed verification, its cap: nothing went back to an agent, and the plugin asked the user \(d1\)\. Until the user answers d1, agent_start, agent_message and an accept of WEB-1 are refused\./);
  assert.match(/## Decisions\n\n[^#]*/.exec(next)?.[0] ?? assert.fail("no decisions section"), /- d1, asked /);
});

test("a catch-up whose call is aborted while it reads bb leaves its updates unread: the next catch-up returns them", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  await startedAgent(kit, threadId);
  textOf(await kit.call("crew_catch_up", {}, threadId));
  await kit.rpc.commentIssue({ coordinatorId, issueId: issueIdSchema.parse("WEB-1"), text: "Use the staging key.", replyTo: null, submission: newSubmission() });

  const aborted = new AbortController();
  kit.threadLists.holding = true;
  const caughtUp = kit.call("crew_catch_up", {}, threadId, aborted.signal);
  while (kit.threadLists.held.length === 0) await new Promise((resolve) => setImmediate(resolve));
  aborted.abort();
  kit.threadLists.holding = false;
  for (const release of kit.threadLists.held.splice(0)) release();
  assert.match(textOf(await caughtUp), /Use the staging key\./, "the answer nobody receives still holds it");

  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /### The user commented on WEB-1[^\n]*\n\n[^\n]*In their own words:\n\nUse the staging key\./);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), /Nothing new since your last catch-up/, "an answered catch-up marks it read");
});

/** A regional manager with an agent on WEB-1 that asked QUESTION, caught up, its thread busy so a doorbell waits in bb's queue. */
async function askedWhileBusy() {
  const started = await coordinating({ verify: false });
  const { kit, threadId } = started;
  await startedAgent(kit, threadId);
  await kit.call("crew_ask_user", { question: QUESTION, options: ["main", "release/2"] }, threadId);
  await kit.call("crew_catch_up", {}, threadId);
  await settled();
  kit.thread(threadId).status = "active";
  return started;
}

const ANSWERED = /The user answered your question d1/;

test("an answer that lands while crew_catch_up reads bb keeps its queued doorbell, which wakes the manager to the next catch-up that returns it", async () => {
  const { kit, threadId, coordinatorId } = await askedWhileBusy();
  const { started: caughtUp, release } = await holdingThreadLists(kit, 1, () => kit.call("crew_catch_up", {}, threadId));
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "release/2" });
  await settled();
  assert.equal(kit.queued(threadId).length, 1, "the answer's doorbell waits behind the catch-up's turn");
  release();

  assert.doesNotMatch(textOf(await caughtUp), ANSWERED, "newer than the catch-up's read");
  await settled();
  const [doorbell = assert.fail("the doorbell was taken back")] = kit.queued(threadId);
  await kit.dispatch(doorbell);
  assert.match(kit.doorbellsDelivered(threadId).at(-1) ?? "", /The user answered your question d1/);
  assert.match(textOf(await kit.call("crew_catch_up", {}, threadId)), ANSWERED);
});

test("a catch-up called while another reads bb returns an answer once between them", async () => {
  const { kit, threadId, coordinatorId } = await askedWhileBusy();
  await kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "release/2" });
  const { started: first, release } = await holdingThreadLists(kit, 1, () => kit.call("crew_catch_up", {}, threadId));
  const second = kit.call("crew_catch_up", {}, threadId);
  // why not required to read bb too: a catch-up that waits for the first to end reads it only after the release.
  await turnsUntil(() => kit.threadLists.held.length === 2);
  release();

  const texts = (await Promise.all([first, second])).map(textOf);
  assert.equal(texts.filter((text) => ANSWERED.test(text)).length, 1);
});

test("an answer to the plugin's question at the cap, sent as its issue is canceled while bb is read, is refused and stores nothing", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  const holderThread = await toCap(kit, threadId, coordinatorId, issue, agentThreadId);
  const holder = kit.store.agents(coordinatorId).find(({ threadId: agentThread }) => agentThread === holderThread) ?? assert.fail("no holder");
  await kit.call("agent_stop", { agent: holder.id }, threadId);
  await settled();
  const before = kit.store.unread(coordinatorId).length;

  const { started: answered, release } = await holdingThreadLists(kit, 1, async () => kit.rpc.answerDecision({ coordinatorId, decisionId: d1, answer: "One more round" }));
  // The manager cancels WEB-1, as issue_update writes it, while the answer's host read is held.
  const canceled = kit.store.updateIssue(coordinatorId, issueIdSchema.parse(issue), { closed: { as: "canceled", at: Date.now() } }, { requireUnheld: true, closes: new Map(), at: Date.now() });
  assert.ok("issue" in canceled, "the cancel was written");
  release();

  await assert.rejects(answered, { code: "conflict", message: "d1 no longer takes an answer: WEB-1 is Canceled, so no round is left for it to allow." });
  assert.equal(kit.store.decision(d1)?.answer, null);
  assert.ok(!kit.store.unread(coordinatorId).slice(before).some(({ event }) => event.kind === "decision-answered"), "nobody is told of an answer");
});

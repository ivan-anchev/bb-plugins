import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { coordinatorContract, roundBodyKey } from "../../contract.ts";
import { handoffIdSchema, type Handoff } from "../../model/agent/handoff.ts";
import { roundKeySchema } from "../../model/feed/round.ts";
import { issueIdSchema, type IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { CheckoutRead } from "../../model/verdict/checkout.ts";
import type { PrSnapshot } from "../../model/verdict/pr.ts";
import type { Store } from "../store/store.ts";
import { filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../store/test-store.ts";
import type { ListBb } from "../agents/threads.ts";
import { createFeedReader } from "./feed-reader.ts";
import { coordinating, doorbellOf, ISSUE, issueIn, settled, startedAgent, textOf, newSubmission, toCap } from "../test-harness.ts";
import { feedHandlers } from "./feed-rpc.ts";

const SHA = "a".repeat(40);
const CLEAN: CheckoutRead = { kind: "read", branch: "bb/retries", checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 } };
const CHECKOUT = { headSha: SHA, changedFiles: [], changedFileCount: 0 };
const MODEL = { providerId: "claude-code", model: "sonnet" };

/** bb's thread list as the reader asks it: every thread named, none deleted, as bb lists a live one. */
const bb: ListBb<{ id: string; deletedAt: number | null }> = {
  sdk: { threads: { list: async ({ threadIds }) => threadIds.map((id) => ({ id, deletedAt: null })) } },
};

/** A done handoff of the issue's agent, reviewed with one finding, verified as failing and sent back, as the plugin's own steps store them. */
function sentBack(store: Store, coordinatorId: CoordinatorId, issueId: IssueId, ticket: string): Handoff {
  const agentId = startAgent(store, issueId, ticket, coordinatorId);
  const handoff: Handoff = {
    id: handoffIdSchema.parse(randomUUID()),
    coordinatorId,
    issueId,
    agentId,
    at: 3_000,
    turnSeq: 1,
    summary: "Retries land",
    did: ["Added retries"],
    evidence: ["npm test → 12 pass"],
    concerns: [],
    deviations: [],
    findings: [],
    status: "done",
    delivery: { kind: "commit", headSha: SHA, prUrl: null },
  };
  const check = store.insertHandoff(handoff, CLEAN) ?? assert.fail("no check");
  const checker = (kind: "reviewer" | "verifier") => {
    store.insertCheckerTicket(`${kind}-${ticket}`, { kind, coordinatorId, issueId, checkId: check.id }, 3_100);
    store.bindTicket(`${kind}-${ticket}`, `thr_${kind}_${ticket}`);
  };
  checker("reviewer");
  store.receiveReview(check.id, `thr_reviewer_${ticket}`, [{ file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap." }], MODEL, 3_200);
  checker("verifier");
  const triage = [{ result: "confirmed", reason: "No cap in retry.ts." }] as const;
  const criteria = [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }] as const;
  store.receiveVerdict(check.id, { state: "returned", verifierThreadId: `thr_verifier_${ticket}`, headSha: SHA, checkout: CHECKOUT, criteria: [...criteria], findings: [], model: MODEL, sameModel: false, triage: [...triage] }, 3_500);
  store.claimFixRound(check.id, { kind: "none" });
  store.settleReturned(check.id, { kind: "sent-back" }, 3_600);
  return handoff;
}

/** WEB-2 with an entry of every kind, the status its round's outcome moved it to, the one it was seen in after its edit and one no moment explains; WEB-1 it depends on, WEB-3 depending on it; and another manager's handoff, the manager then removed. */
function seeded() {
  const { store } = freshStore();
  const dependency = filedIssue(store, MANAGER, newIssue(), 1_000).id;
  const issueId = filedIssue(store, MANAGER, newIssue({ dependsOn: [dependency] }), 1_000).id;
  filedIssue(store, MANAGER, newIssue({ dependsOn: [issueId] }), 1_000);
  const handoff = sentBack(store, MANAGER, issueId, "agent-1");
  const agentId = handoff.agentId;
  // why here: the move its verdict's going back made, observed after its outcome, as the watch logs it.
  store.observeStatuses(MANAGER, [{ issue: store.issue(MANAGER, issueId) ?? assert.fail("no issue"), status: "in-progress" }], 3_650);
  store.insertDecision(MANAGER, { question: "Which queue?", options: ["SQS", "Redis"], issueId }, 3_700);
  store.updateIssue(MANAGER, issueId, { decision: { text: "SQS: it is already deployed.", at: 3_800 } }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  const pr: PrSnapshot = { number: 7, url: "https://github.com/acme/webhooks/pull/7", state: "open", draft: false, review: "none", ci: "pending", headSha: SHA, failedChecks: [] };
  store.insertEvent(MANAGER, { kind: "pr", issueId, agentId, pr, changes: ["opened"] }, 3_900);
  store.insertEvent(MANAGER, { kind: "idle-without-handoff", issueId, agentId, lastAnswer: "Still on it." }, 4_000);
  store.insertEvent(MANAGER, { kind: "unblocked", issueId, by: dependency, closedAs: "done" }, 4_100);
  store.endAgent({ coordinatorId: MANAGER, id: agentId, issueId }, "stopped", null, false, 4_200);
  store.updateIssue(MANAGER, issueId, { title: "Retries, capped" }, { requireUnheld: false, closes: new Map(), at: 4_300 });
  const asked = store.commentIssue(MANAGER, { issueId, author: { kind: "user" }, text: "Cap them at five?", replyTo: null, submission: null }, 4_350) ?? assert.fail("not posted");
  store.commentIssue(MANAGER, { issueId, author: { kind: "manager" }, text: "Yes, five.", replyTo: asked, submission: null }, 4_360);
  const issue = store.issue(MANAGER, issueId) ?? assert.fail("no issue");
  store.observeStatuses(MANAGER, [{ issue, status: "todo" }], 4_400);
  store.observeStatuses(MANAGER, [{ issue, status: "backlog" }], 4_500);

  const elsewhere = sentBack(store, OTHER_MANAGER, filedIssue(store, OTHER_MANAGER, newIssue(), 1_000).id, "agent-2");
  store.removeCoordinator(OTHER_MANAGER);
  // why no inbox: these tests post nothing; posting is the harness's, below.
  const handlers = feedHandlers({ store, reader: createFeedReader(bb, store), inbox: { commentIssue: () => assert.fail("posted") } });
  return { handlers, issueId, handoff, elsewhere };
}

const keysOf = (value: object) => Object.keys(value).sort();
/** The feed as the handler answers it: what the RPC sends. */
type Fed = Awaited<ReturnType<ReturnType<typeof feedHandlers>["issueFeed"]>>;
type FedEntry = Fed["entries"][number];
const byKind = (feed: Fed) => new Map(feed.entries.map((entry): [FedEntry["kind"], FedEntry] => [entry.kind, entry]));

test("an issue's feed sends exactly what its tab reads: its plan's text and relations, its agents' threads, and each entry kind's own fields", async () => {
  const { handlers, issueId } = seeded();
  const feed = await handlers.issueFeed({ coordinatorId: MANAGER, issueId });
  assert.deepStrictEqual(keysOf(feed), ["agents", "blocks", "dependsOn", "description", "doneCriteria", "entries"]);
  assert.deepStrictEqual([feed.dependsOn, feed.blocks, feed.agents], [["WEB-1"], ["WEB-3"], [{ id: "a1", threadId: "thr_agent-1" }]]);
  assert.deepStrictEqual(
    feed.entries.map(({ kind }) => kind),
    ["created", "agent-started", "round", "decision", "decision", "pr", "thread", "unblocked", "agent-ended", "logged", "comment", "comment", "moved"],
  );
  const entries = byKind(feed);
  const expected: Record<FedEntry["kind"], string[]> = {
    created: ["at", "kind", "moved"],
    logged: ["at", "event", "kind", "moved"],
    "agent-started": ["agentId", "at", "kind", "moved"],
    "agent-ended": ["agentId", "at", "how", "kind", "moved"],
    round: ["kind", "round"],
    decision: ["decision", "kind", "moved"],
    comment: ["comment", "kind"],
    pr: ["at", "changes", "kind", "moved", "number"],
    thread: ["agentId", "at", "event", "kind", "moved"],
    unblocked: ["at", "by", "kind", "moved"],
    moved: ["at", "kind", "status"],
  };
  assert.deepStrictEqual([...entries.keys()].sort(), keysOf(expected), "an entry of every kind");
  for (const [kind, entry] of entries) assert.deepStrictEqual(keysOf(entry), expected[kind], kind);
  const round = entries.get("round");
  assert.ok(round?.kind === "round");
  assert.deepStrictEqual(keysOf(round.round), ["by", "handed", "inFlight", "key", "number", "outcome", "review", "verdict"]);
  assert.deepStrictEqual(
    { by: round.round.by, handed: round.round.handed, review: round.round.review, verdict: round.round.verdict, outcome: round.round.outcome, inFlight: round.round.inFlight },
    {
      by: { kind: "agent", agentId: "a1", status: "done", summary: "Retries land" },
      handed: { at: 3_000, moved: null },
      review: { state: "reported", step: { at: 3_200, moved: null }, findings: 1, confirmed: 1 },
      verdict: { outcome: { kind: "fail", by: "criteria" }, results: ["fail"], fixRound: { round: 1, delivery: "sent" }, step: { at: 3_500, moved: null }, asked: null },
      outcome: { at: 3_600, moved: "in-progress" },
      inFlight: false,
    },
  );
  const asked = feed.entries.find((entry) => entry.kind === "decision" && entry.decision.kind === "asked");
  assert.ok(asked?.kind === "decision");
  assert.deepStrictEqual(keysOf(asked.decision), ["answer", "at", "id", "kind", "options", "question"]);
  assert.deepStrictEqual(
    feed.entries.flatMap((entry) => (entry.kind === "comment" ? [entry.comment] : [])),
    [
      { id: "m1", issueId, at: 4_350, text: "Cap them at five?", replyTo: null, author: { kind: "user" } },
      { id: "m2", issueId, at: 4_360, text: "Yes, five.", replyTo: "m1", author: { kind: "manager" } },
    ],
  );
  assert.deepStrictEqual([entries.get("logged"), entries.get("moved")], [
    { kind: "logged", at: 4_300, event: { kind: "edited", fields: ["title"] }, moved: "todo" },
    { kind: "moved", at: 4_500, status: "backlog" },
  ]);
  const thread = entries.get("thread");
  assert.deepStrictEqual(thread?.kind === "thread" && thread.event, { kind: "reported-back", lastAnswer: "Still on it." });
});

test("an opened round's body sends its handoff, its verdict and the findings with their triage; a key of a removed manager, or none of a round, reads null beside it", async () => {
  const { handlers, issueId, handoff, elsewhere } = seeded();
  const key = roundBodyKey(MANAGER, issueId, roundKeySchema.parse(`h-${handoff.id}`));
  const gone = roundBodyKey(OTHER_MANAGER, elsewhere.issueId, roundKeySchema.parse(`h-${elsewhere.id}`));
  const otherIssue = roundBodyKey(MANAGER, elsewhere.issueId, roundKeySchema.parse(`h-${handoff.id}`));
  // why this one: it passes a shape-only check (h- and 36 of [0-9a-f-]) but is no handoff id.
  const notAnId = `${MANAGER}/${issueId}/h-${"-".repeat(36)}`;
  const bodies = await handlers.roundBodies({ keys: [key, gone, otherIssue, "not a key", notAnId] });
  assert.deepStrictEqual(keysOf(bodies), [gone, key, otherIssue, "not a key", notAnId].sort());
  assert.deepStrictEqual([bodies[gone], bodies[otherIssue], bodies["not a key"], bodies[notAnId]], [null, null, null, null]);
  const body = bodies[key] ?? assert.fail("no body");
  assert.deepStrictEqual(keysOf(body), ["findings", "handoff", "reviewMissed", "verdict"]);
  assert.equal(body.reviewMissed, null, "a review was had");
  assert.deepStrictEqual(keysOf(body.handoff ?? assert.fail()), ["concerns", "deviations", "did", "evidence", "findings", "report"], "no id, time, status or summary: the folded round has them");
  assert.deepStrictEqual(keysOf(body.verdict ?? assert.fail()), ["checkout", "criteria", "findings", "headSha", "sameModel", "settlement", "state", "verifierThreadId"]);
  assert.deepStrictEqual(body.findings, [{ file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap.", triage: { result: "confirmed", reason: "No cap in retry.ts." } }]);
});

test("the feed of an issue the manager doesn't have, or of a manager not started, is refused", async () => {
  const { handlers } = seeded();
  await assert.rejects(async () => handlers.issueFeed({ coordinatorId: MANAGER, issueId: issueIdSchema.parse("WEB-9") }), /has no issue WEB-9/);
  await assert.rejects(async () => handlers.issueFeed({ coordinatorId: OTHER_MANAGER, issueId: issueIdSchema.parse("WEB-1") }), /no started regional manager/);
});

test("the user's comment, posted through commentIssue, answers only its id, wakes the regional manager, and its catch-up gives it whole with its issue and author", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const issueId = issueIdSchema.parse(issueIn(textOf(await kit.call("issue_create", ISSUE, threadId))));
  await kit.call("crew_catch_up", {}, threadId);
  kit.thread(threadId).status = "idle";
  const text = "Cap retries at five.\n\nAnd log each one.";

  // why the raw answer: the contract's parse would drop a key the handler added.
  const raw = await kit.rpc.commentIssue({ coordinatorId, issueId, text, replyTo: null, submission: newSubmission() });
  assert.deepStrictEqual(keysOf(raw), ["commentId"]);
  const posted = coordinatorContract.commentIssue.output.parse(raw);
  await settled();

  assert.deepStrictEqual(kit.doorbellsSent(threadId), [doorbellOf(`The user commented on ${issueId} "Add retries": ${posted.commentId}`)]);
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  const update = caughtUp.slice(caughtUp.indexOf("### "), caughtUp.indexOf("## Board"));
  assert.match(update, new RegExp(`^### The user commented on ${issueId} "Add retries": ${posted.commentId}\n\nAt [^\n]+ In their own words:\n\n${text.replaceAll("\n", "\\n")}\n\n`));
  assert.ok(update.includes(`Reply on the issue with issue_comment (issue "${issueId}", replyTo "${posted.commentId}")`), update);

  const feed = coordinatorContract.issueFeed.output.parse(await kit.rpc.issueFeed({ coordinatorId, issueId }));
  const entry = feed.entries.find((one) => one.kind === "comment") ?? assert.fail("no comment entry");
  assert.deepStrictEqual(keysOf(entry), ["comment", "kind"]);
  assert.ok(entry.kind === "comment");
  assert.deepStrictEqual(keysOf(entry.comment), ["at", "author", "id", "issueId", "replyTo", "text"]);
  assert.deepStrictEqual({ ...entry.comment, at: 0 }, { id: posted.commentId, issueId, at: 0, text, replyTo: null, author: { kind: "user" } });
});

test("a commentIssue retried with the same submission after its answer was lost answers the first comment's id, posts nothing more and wakes the manager once", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const issueId = issueIdSchema.parse(issueIn(textOf(await kit.call("issue_create", ISSUE, threadId))));
  await kit.call("crew_catch_up", {}, threadId);
  kit.thread(threadId).status = "idle";
  const input = { coordinatorId, issueId, text: "Cap retries at five.", replyTo: null, submission: newSubmission() };

  const first = await kit.rpc.commentIssue(input);
  const retry = await kit.rpc.commentIssue(input);
  assert.deepStrictEqual(retry, first);
  await settled();
  assert.deepStrictEqual(kit.store.commentsOf(coordinatorId, issueId).map(({ id }) => id), [first.commentId]);
  assert.deepStrictEqual(kit.doorbellsSent(threadId), [doorbellOf(`The user commented on ${issueId} "Add retries": ${first.commentId}`)]);
  const caughtUp = textOf(await kit.call("crew_catch_up", {}, threadId));
  assert.ok(caughtUp.includes("1 update since your last catch-up"), caughtUp.slice(0, 300));
});

test("a comment on an issue the manager doesn't have, or one of a manager not started, is refused, and nothing wakes it", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  kit.thread(threadId).status = "idle";
  await assert.rejects(async () => kit.rpc.commentIssue({ coordinatorId, issueId: issueIdSchema.parse("WEB-9"), text: "Hello?", replyTo: null, submission: newSubmission() }), /has no issue WEB-9/);
  await assert.rejects(async () => kit.rpc.commentIssue({ coordinatorId: OTHER_MANAGER, issueId: issueIdSchema.parse("WEB-1"), text: "Hello?", replyTo: null, submission: newSubmission() }), /no started regional manager/);
  await settled();
  assert.deepStrictEqual(kit.doorbellsSent(threadId), []);
});

test("the user's comment can answer a comment of the same issue; one naming no comment of it is refused, and nothing is posted", async () => {
  const { kit, threadId, coordinatorId } = await coordinating({ verify: false });
  const [one, two] = [issueIdSchema.parse(issueIn(textOf(await kit.call("issue_create", ISSUE, threadId)))), issueIdSchema.parse(issueIn(textOf(await kit.call("issue_create", ISSUE, threadId))))];
  const asked = coordinatorContract.commentIssue.output.parse(await kit.rpc.commentIssue({ coordinatorId, issueId: one, text: "Cap retries?", replyTo: null, submission: newSubmission() }));
  await kit.call("issue_comment", { issue: one, text: "At five?", replyTo: asked.commentId }, threadId);
  const answered = kit.store.commentsOf(coordinatorId, one).at(-1) ?? assert.fail("no reply");

  const reply = coordinatorContract.commentIssue.output.parse(await kit.rpc.commentIssue({ coordinatorId, issueId: one, text: "Yes, five.", replyTo: answered.id, submission: newSubmission() }));
  assert.equal(kit.store.comment(reply.commentId)?.replyTo, answered.id);
  await assert.rejects(async () => kit.rpc.commentIssue({ coordinatorId, issueId: two, text: "Elsewhere.", replyTo: answered.id, submission: newSubmission() }), new RegExp(`${answered.id} is no comment on ${two}, so nothing was posted`));
  assert.deepStrictEqual(kit.store.commentsOf(coordinatorId, two), []);
});

test("through the feed RPC, only the round whose failure asked at the cap carries the question and its count, and every other round's verdict says it asked nothing", async () => {
  const { kit, threadId, coordinatorId } = await coordinating();
  const { issue, agentThreadId } = await startedAgent(kit, threadId);
  await toCap(kit, threadId, coordinatorId, issue, agentThreadId);
  const feed = coordinatorContract.issueFeed.output.parse(await kit.rpc.issueFeed({ coordinatorId, issueId: issueIdSchema.parse(issue) }));
  const rounds = feed.entries.flatMap((entry) => (entry.kind === "round" ? [entry.round] : []));
  assert.deepEqual(rounds.map(({ number, by }) => [number, by.kind === "agent" ? by.agentId : null]), [[1, "a1"], [2, "a1"], [3, "a2"]], "three rounds, the third by another agent");
  const verdicts = rounds.map(({ verdict }) => verdict ?? assert.fail("no verdict"));
  for (const verdict of verdicts) assert.deepStrictEqual(keysOf(verdict), ["asked", "fixRound", "outcome", "results", "step"]);
  assert.deepStrictEqual(verdicts.map(({ asked }) => asked), [null, null, { decisionId: "d1", failed: 3 }]);
  assert.deepStrictEqual(keysOf(verdicts[2]?.asked ?? assert.fail("not asked")), ["decisionId", "failed"]);
  const decision = feed.entries.find((entry) => entry.kind === "decision");
  assert.ok(decision?.kind === "decision" && decision.decision.kind === "asked" && decision.decision.id === "d1", "the question shows as the issue's decision entry");
  assert.deepStrictEqual(keysOf(decision.decision), ["answer", "at", "id", "kind", "options", "question"]);
});

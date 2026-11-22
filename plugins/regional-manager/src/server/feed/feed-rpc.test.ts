import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { roundBodyKey } from "../../contract.ts";
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

/** WEB-2 with an entry of every kind; WEB-1 it depends on, WEB-3 depending on it; and another manager's handoff, the manager then removed. */
function seeded() {
  const { store } = freshStore();
  const dependency = filedIssue(store, MANAGER, newIssue(), 1_000).id;
  const issueId = filedIssue(store, MANAGER, newIssue({ dependsOn: [dependency] }), 1_000).id;
  filedIssue(store, MANAGER, newIssue({ dependsOn: [issueId] }), 1_000);
  const handoff = sentBack(store, MANAGER, issueId, "agent-1");
  const agentId = handoff.agentId;
  store.insertDecision(MANAGER, { question: "Which queue?", options: ["SQS", "Redis"], issueId }, 3_700);
  store.updateIssue(MANAGER, issueId, { decision: { text: "SQS: it is already deployed.", at: 3_800 } }, { requireUnheld: false, closes: new Map() });
  const pr: PrSnapshot = { number: 7, url: "https://github.com/acme/webhooks/pull/7", state: "open", draft: false, review: "none", ci: "pending", headSha: SHA, failedChecks: [] };
  store.insertEvent(MANAGER, { kind: "pr", issueId, agentId, pr, changes: ["opened"] }, 3_900);
  store.insertEvent(MANAGER, { kind: "idle-without-handoff", issueId, agentId, lastAnswer: "Still on it." }, 4_000);
  store.insertEvent(MANAGER, { kind: "unblocked", issueId, by: dependency, closedAs: "done" }, 4_100);
  store.endAgent({ coordinatorId: MANAGER, id: agentId, issueId }, "stopped", null, false, 4_200);

  const elsewhere = sentBack(store, OTHER_MANAGER, filedIssue(store, OTHER_MANAGER, newIssue(), 1_000).id, "agent-2");
  store.removeCoordinator(OTHER_MANAGER);
  const handlers = feedHandlers({ store, reader: createFeedReader(bb, store) });
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
    ["created", "agent-started", "round", "decision", "decision", "pr", "thread", "unblocked", "agent-ended"],
  );
  const entries = byKind(feed);
  const expected: Record<FedEntry["kind"], string[]> = {
    created: ["at", "kind"],
    "agent-started": ["agentId", "at", "kind"],
    "agent-ended": ["agentId", "at", "how", "kind"],
    round: ["kind", "round"],
    decision: ["decision", "kind"],
    pr: ["at", "changes", "kind", "number"],
    thread: ["agentId", "at", "event", "kind"],
    unblocked: ["at", "by", "kind"],
  };
  assert.deepStrictEqual([...entries.keys()].sort(), keysOf(expected), "an entry of every kind");
  for (const [kind, entry] of entries) assert.deepStrictEqual(keysOf(entry), expected[kind], kind);
  const round = entries.get("round");
  assert.ok(round?.kind === "round");
  assert.deepStrictEqual(keysOf(round.round), ["at", "by", "inFlight", "key", "number", "outcomeAt", "review", "verdict"]);
  assert.deepStrictEqual(
    { by: round.round.by, review: round.round.review, verdict: round.round.verdict, outcomeAt: round.round.outcomeAt, inFlight: round.round.inFlight },
    {
      by: { kind: "agent", agentId: "a1", status: "done", summary: "Retries land" },
      review: { state: "reported", at: 3_200, findings: 1, confirmed: 1 },
      verdict: { outcome: { kind: "fail", by: "criteria" }, results: ["fail"], fixRound: { round: 1, delivery: "sent" } },
      outcomeAt: 3_600,
      inFlight: false,
    },
  );
  const asked = feed.entries.find((entry) => entry.kind === "decision" && entry.decision.kind === "asked");
  assert.ok(asked?.kind === "decision");
  assert.deepStrictEqual(keysOf(asked.decision), ["answer", "at", "id", "kind", "options", "question"]);
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
  assert.deepStrictEqual(keysOf(body.verdict ?? assert.fail()), ["at", "checkout", "criteria", "findings", "headSha", "sameModel", "settlement", "state", "verifierThreadId"]);
  assert.deepStrictEqual(body.findings, [{ file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap.", triage: { result: "confirmed", reason: "No cap in retry.ts." } }]);
});

test("the feed of an issue the manager doesn't have, or of a manager not started, is refused", async () => {
  const { handlers } = seeded();
  await assert.rejects(async () => handlers.issueFeed({ coordinatorId: MANAGER, issueId: issueIdSchema.parse("WEB-9") }), /has no issue WEB-9/);
  await assert.rejects(async () => handlers.issueFeed({ coordinatorId: OTHER_MANAGER, issueId: issueIdSchema.parse("WEB-1") }), /no started regional manager/);
});

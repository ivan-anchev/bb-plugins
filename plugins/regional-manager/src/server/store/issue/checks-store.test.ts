import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AgentId } from "../../../model/agent/agent.ts";
import { handoffIdSchema, type Handoff } from "../../../model/agent/handoff.ts";
import { issueIdSchema, type IssueId } from "../../../model/issue/issue.ts";
import type { Check } from "../../../model/verdict/check.ts";
import type { CheckoutRead } from "../../../model/verdict/checkout.ts";
import type { PrSnapshot } from "../../../model/verdict/pr.ts";
import { issueViews } from "../../../model/issue/status.ts";
import type { ReviewFinding } from "../../../model/verdict/review.ts";
import { judge } from "../../../model/verdict/verdict.ts";
import { openStore, type Store } from "../store.ts";
import { EXECUTION, failWrites, filedIssue, freshStore, MANAGER, newIssue, startAgent } from "../test-store.ts";

const SHA = "a".repeat(40);
const CLEAN: CheckoutRead = { kind: "read", branch: "bb/thr_1", checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 } };
const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };

function handoff(issueId: IssueId, agentId: AgentId, status: "done" | "blocked", at = 3_000): Handoff {
  const made = { id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId, agentId, at, turnSeq: 1 };
  return status === "done" ? { ...made, ...report, status, delivery: { kind: "commit", headSha: SHA, prUrl: null } } : { ...made, ...report, status };
}

function withAgent() {
  const { db, storage, store } = freshStore();
  const issue = filedIssue(store, MANAGER, newIssue({ doneCriteria: ["npm test passes", "npm run lint passes"], verifier: EXECUTION }), 2_000);
  return { db, storage, store, issue, agentId: startAgent(store, issue.id, "agent-1") };
}

function checkOf(made: Check | null): Check {
  return made ?? assert.fail("the done handoff made no check");
}

type Received = Parameters<Store["receiveVerdict"]>[1];

const returned = (verifierThreadId: string, result: "pass" | "fail"): Received => ({
  state: "returned",
  verifierThreadId,
  headSha: SHA,
  checkout: CLEAN.checkout,
  criteria: [{ criterion: "npm test passes", result, evidence: "npm test" }],
  findings: [],
  blocking: [],
  model: { providerId: "claude-code", model: "sonnet" },
  sameModel: false,
  triage: [],
});

/** A done handoff's check, running in the verifier thread `thr_verifier_<n>`. */
function runningCheck(store: Store, issueId: IssueId, agentId: AgentId, n: number): Check {
  const check = checkOf(store.insertHandoff(handoff(issueId, agentId, "done", 3_000 + n), CLEAN));
  store.insertCheckerTicket(`verifier-${n}`, { kind: "verifier", coordinatorId: MANAGER, issueId, checkId: check.id }, 3_000);
  store.bindTicket(`verifier-${n}`, `thr_verifier_${n}`);
  return check;
}

/** A done handoff's check whose reviewer reported one must-fix finding, running in the verifier thread `thr_verifier_<n>`. */
const reviewedCheck = (store: Store, issueId: IssueId, agentId: AgentId, n: number): Check => reviewedWith(store, issueId, agentId, n, [CAPLESS]);

type Finding = ReviewFinding;
const CAPLESS: Finding = { file: "src/retry.ts", line: 42, severity: "must-fix", claim: "The backoff never caps.", origin: "new" };

/** A done handoff's check whose reviewer reported `findings`, running in the verifier thread `thr_verifier_<n>`. */
function reviewedWith(store: Store, issueId: IssueId, agentId: AgentId, n: number, findings: Finding[]): Check {
  const check = checkOf(store.insertHandoff(handoff(issueId, agentId, "done", 3_000 + n), CLEAN));
  const at = { coordinatorId: MANAGER, issueId, checkId: check.id };
  store.insertCheckerTicket(`reviewer-${n}`, { kind: "reviewer", ...at }, 3_000);
  store.bindTicket(`reviewer-${n}`, `thr_reviewer_${n}`);
  assert.equal(store.receiveReview(check.id, `thr_reviewer_${n}`, { findings, earlier: [] }, { providerId: "codex", model: "gpt-default" }, 3_000 + n), true);
  store.insertCheckerTicket(`verifier-${n}`, { kind: "verifier", ...at }, 3_000);
  store.bindTicket(`verifier-${n}`, `thr_verifier_${n}`);
  return check;
}

/** A verdict that passed every criterion and confirmed its review's must-fix finding. */
const confirmedMustFix = (verifierThreadId: string): Received => ({ ...returned(verifierThreadId, "pass"), triage: [{ result: "confirmed", reason: "It never caps." }] });

const CHECKED = { kind: "checked", refused: null, ci: { kind: "none" } } as const;

const events = (store: Store) => store.unannounced(MANAGER).map(({ event }) => event);

test("a done handoff makes a queued check that copies its issue's criteria and verifier as they are then, and tells nobody yet", () => {
  const { store, issue, agentId } = withAgent();
  const done = handoff(issue.id, agentId, "done");
  const check = checkOf(store.insertHandoff(done, CLEAN));

  store.updateIssue(MANAGER, issue.id, { doneCriteria: ["npm test passes"], verifier: null }, { requireUnheld: false, closes: new Map(), at: 3_000 });

  assert.deepEqual(store.check(check.id), {
    id: check.id,
    coordinatorId: MANAGER,
    issueId: issue.id,
    at: 3_000,
    criteria: ["npm test passes", "npm run lint passes"],
    verifier: EXECUTION,
    subject: { kind: "handoff", agentId, handoffId: done.id, headSha: SHA, prUrl: null, branch: "bb/thr_1" },
    review: { state: "queued" },
    verdict: { state: "queued", checkout: CLEAN.checkout },
    followUpId: null,
    acceptedAt: null,
  });
  assert.deepEqual(store.handoff(done.id), { handoff: done, check });
  assert.deepEqual(store.latestHandoff(MANAGER, agentId), { handoff: done, check });
  assert.deepEqual(events(store), []);
});

test("a done handoff no verifier will check is announced at once: verification off, or its environment unread", () => {
  const { store, issue, agentId } = withAgent();
  store.setVerify(MANAGER, false, 2_500);
  const waived = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.setVerify(MANAGER, true, 2_600);
  const unread = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), { kind: "unread", reason: "the sandbox is asleep" }));

  assert.deepEqual(waived.verdict, { state: "waived" });
  assert.equal(unread.verdict.state, "could-not-run");
  assert.deepEqual(events(store), [
    { kind: "verification-toggled", verify: false },
    { kind: "checked", issueId: issue.id, checkId: waived.id, asked: null },
    { kind: "verification-toggled", verify: true },
    { kind: "checked", issueId: issue.id, checkId: unread.id, asked: null },
  ]);
});

test("a blocked handoff gets no check and is announced at once", () => {
  const { store, issue, agentId } = withAgent();
  const blocked = handoff(issue.id, agentId, "blocked");
  assert.equal(store.insertHandoff(blocked, CLEAN), null);
  assert.deepEqual(events(store), [{ kind: "handoff", issueId: issue.id, agentId, handoffId: blocked.id, status: "blocked" }]);
});

test("a newer done handoff supersedes the issue's checks still waiting", () => {
  const { store, issue, agentId } = withAgent();
  const queued = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_000), CLEAN));
  const running = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_100), CLEAN));
  store.insertCheckerTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: running.id }, 3_100);
  store.bindTicket("verifier-1", "thr_verifier");

  const newest = store.insertHandoff(handoff(issue.id, agentId, "done", 3_200), CLEAN);

  assert.deepEqual([store.check(queued.id)?.verdict, store.check(running.id)?.verdict], [{ state: "superseded" }, { state: "superseded" }]);
  assert.deepEqual(store.openChecks().map(({ id }) => id), [checkOf(newest).id]);
  assert.deepEqual(store.record(MANAGER, issue.id).map(({ check }) => check?.verdict.state), ["superseded", "superseded", "queued"]);
});

test("a check starts running as its verifier's ticket binds, is nudged once, un-nudged once, and is given up only from where it is", () => {
  const { store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertCheckerTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  assert.deepEqual(store.bindTicket("verifier-1", "thr_verifier"), { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id });
  assert.deepEqual(store.check(check.id)?.verdict, { state: "running", verifierThreadId: "thr_verifier", nudged: false, declined: [], checkout: CLEAN.checkout });

  assert.equal(store.markNudged(check.id, "thr_verifier", true), true);
  assert.equal(store.markNudged(check.id, "thr_verifier", true), false);
  assert.equal(store.markNudged(check.id, "thr_other", false), false, "only for its running verifier");
  assert.equal(store.markNudged(check.id, "thr_verifier", false), true, "its reminder was taken back from bb's queue");
  assert.equal(store.markNudged(check.id, "thr_verifier", false), false);

  const gaveUp = { verifierThreadId: "thr_verifier", reason: "its verifier stopped without a verdict" } as const;
  assert.equal(store.giveUpCheck(check.id, { state: "queued" }, gaveUp, 4_000), null, "it isn't queued any more");
  assert.equal(store.giveUpCheck(check.id, { state: "running", verifierThreadId: "thr_verifier" }, gaveUp, 4_000), MANAGER);
  assert.deepEqual(store.check(check.id)?.verdict, { state: "could-not-run", at: 4_000, ...gaveUp });
  assert.deepEqual(events(store), [{ kind: "checked", issueId: issue.id, checkId: check.id, asked: null }]);
});

test("a fix round claimed before its findings are sent survives a reload, and settles once, with the event that says it was sent back", () => {
  const { storage, store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertCheckerTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  store.bindTicket("verifier-1", "thr_verifier");
  const failed: Received = {
    state: "returned",
    verifierThreadId: "thr_verifier",
    headSha: SHA,
    checkout: CLEAN.checkout,
    criteria: [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }],
    findings: [],
    blocking: [],
    model: { providerId: "claude-code", model: "sonnet" },
    sameModel: false,
    triage: [],
  };
  assert.equal(store.receiveVerdict(check.id, { ...failed, verifierThreadId: "thr_other" }, 4_500), false, "only its running verifier's verdict is taken");
  assert.equal(store.receiveVerdict(check.id, failed, 4_500), true);
  assert.deepEqual(store.unsettledChecks(), [check.id]);
  store.claimFixRound(check.id, { kind: "none" });

  const reloaded = openStore(storage);
  assert.equal(reloaded.agent(MANAGER, agentId)?.fixRounds, 1);
  assert.equal(reloaded.settleReturned(check.id, { kind: "sent-back" }, 4_000, null), MANAGER);
  assert.equal(reloaded.settleReturned(check.id, { kind: "sent-back" }, 4_000, null), null, "settled once");
  assert.deepEqual(reloaded.unsettledChecks(), []);
  assert.deepEqual(events(reloaded), [{ kind: "sent-back", issueId: issue.id, agentId, checkId: check.id, round: 1 }]);
});

test("every verdict the store receives is judged by the must-fix rule: one that passes every criterion but confirms a must-fix finding fails", () => {
  const { store, issue, agentId } = withAgent();
  const check = reviewedCheck(store, issue.id, agentId, 1);
  assert.equal(store.receiveVerdict(check.id, confirmedMustFix("thr_verifier_1"), 4_000), true);
  const stored = store.check(check.id)?.verdict;
  assert.ok(stored?.state === "returned");
  assert.equal(stored.mustFixFails, true, "the store sets it; no caller passes it");
  assert.equal(judge(stored, { kind: "none" }), "fail");
});

test("a verdict that passed waits for CI, and one settled as checked gives back a round claimed for findings that never left", () => {
  const { store, issue, agentId } = withAgent();

  const passed = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(passed.id, returned("thr_verifier_1", "pass"), 4_500);
  assert.equal(store.settleReturned(passed.id, { kind: "waiting-for-ci" }, 4_000, null), MANAGER);
  assert.deepEqual(store.waitingForCi(MANAGER, agentId), [passed.id]);
  assert.deepEqual(events(store), [], "nobody is told while it waits for CI");

  const waiting = store.check(passed.id)?.verdict;
  const failed = runningCheck(store, issue.id, agentId, 2);
  assert.deepEqual(store.check(passed.id)?.verdict, { ...waiting, settlement: { kind: "superseded" } }, "a newer done handoff supersedes one waiting for CI, its verdict kept whole");
  store.receiveVerdict(failed.id, returned("thr_verifier_2", "fail"), 4_500);
  store.claimFixRound(failed.id, { kind: "none" });
  assert.equal(store.settleReturned(failed.id, { kind: "checked", refused: "bb refused the message", ci: { kind: "none" } }, 4_100, null), MANAGER);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 0);
  assert.deepEqual(events(store), [{ kind: "checked", issueId: issue.id, checkId: failed.id, asked: null }]);
});

test("a done handoff that fails partway leaves no handoff, no check, the checks it would supersede waiting, and nothing told", () => {
  const { db, store, issue, agentId } = withAgent();
  checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_000), CLEAN));
  store.setVerify(MANAGER, false, 3_050);
  failWrites(db, "INSERT", "events");

  const failing = handoff(issue.id, agentId, "done", 3_100);
  assert.throws(() => store.insertHandoff(failing, CLEAN), /forced failure/);
  assert.equal(store.handoff(failing.id), null);
  assert.deepEqual(store.record(MANAGER, issue.id).map(({ check }) => check?.verdict.state), ["queued"]);
  assert.deepEqual(events(store), [{ kind: "verification-toggled", verify: false }]);
});

test("a done handoff that fails partway keeps the checks waiting for CI whole and waiting, and a retry supersedes the one that passed all but CI once, leaving one the must-fix rule fails to settle", () => {
  const { db, store, issue, agentId } = withAgent();
  // As a verdict that waited for CI before a confirmed must-fix finding could fail one is left (migrations.ts).
  const fails = reviewedCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(fails.id, confirmedMustFix("thr_verifier_1"), 3_900);
  assert.equal(store.settleReturned(fails.id, { kind: "waiting-for-ci" }, 4_000, null), MANAGER);
  const passed = runningCheck(store, issue.id, agentId, 2);
  assert.deepEqual(store.waitingForCi(MANAGER, agentId), [fails.id], "the newer handoff left the one the rule fails waiting");
  store.receiveVerdict(passed.id, returned("thr_verifier_2", "pass"), 4_050);
  assert.equal(store.settleReturned(passed.id, { kind: "waiting-for-ci" }, 4_100, null), MANAGER);
  const before = [store.check(fails.id)?.verdict, store.check(passed.id)?.verdict];
  const newer = handoff(issue.id, agentId, "done", 5_000);
  const restore = failWrites(db, "INSERT", "checks");
  assert.throws(() => store.insertHandoff(newer, CLEAN), /forced failure/);
  assert.equal(store.handoff(newer.id), null);
  assert.deepEqual([store.check(fails.id)?.verdict, store.check(passed.id)?.verdict], before, "both verdicts and settlements kept");
  assert.deepEqual(store.waitingForCi(MANAGER, agentId), [fails.id, passed.id]);

  restore();
  const made = checkOf(store.insertHandoff(newer, CLEAN));
  assert.deepEqual(store.check(passed.id)?.verdict, { ...before[1], settlement: { kind: "superseded" } }, "superseded, its verdict kept whole");
  assert.deepEqual(store.check(fails.id)?.verdict, before[0], "left for its settlement to judge failed");
  assert.deepEqual(store.waitingForCi(MANAGER, agentId), [fails.id]);
  assert.deepEqual(store.unsettledChecks(), [fails.id]);
  assert.deepEqual(store.record(MANAGER, issue.id).map(({ check }) => check?.id), [fails.id, passed.id, made.id], "one newer check");
  assert.deepEqual(events(store), [], "nobody is told");
});

test("a verifier's ticket whose check fails to start stays unbound", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertCheckerTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  failWrites(db, "UPDATE", "checks");
  assert.throws(() => store.bindTicket("verifier-1", "thr_verifier_1"), /forced failure/);
  assert.equal(store.roleOfThread("thr_verifier_1"), null);
});

test("a check given up that fails before the manager is told keeps running", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = runningCheck(store, issue.id, agentId, 1);
  failWrites(db, "INSERT", "events");
  const gaveUp = { verifierThreadId: "thr_verifier_1", reason: "its verifier stopped without a verdict" } as const;
  assert.throws(() => store.giveUpCheck(check.id, { state: "running", verifierThreadId: "thr_verifier_1" }, gaveUp, 4_000), /forced failure/);
  assert.equal(store.check(check.id)?.verdict.state, "running");
});

test("a fix round whose claim fails partway is not counted, and a retry claims it once", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(check.id, returned("thr_verifier_1", "fail"), 4_500);
  const restore = failWrites(db, "UPDATE", "checks");
  assert.throws(() => store.claimFixRound(check.id, { kind: "none" }), /forced failure/);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 0);

  restore();
  store.claimFixRound(check.id, { kind: "none" });
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 1);
  const claimed = store.check(check.id)?.verdict;
  assert.deepEqual(claimed?.state === "returned" && claimed.settlement, { kind: "sending-back", round: 1, ci: { kind: "none" } });
});

test("a settlement that fails before the manager is told leaves the verdict unsettled and its round claimed, and a retry settles it once", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(check.id, returned("thr_verifier_1", "fail"), 4_500);
  store.claimFixRound(check.id, { kind: "none" });
  const restore = failWrites(db, "INSERT", "events");
  assert.throws(() => store.settleReturned(check.id, { kind: "sent-back" }, 4_000, null), /forced failure/);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 1);
  assert.deepEqual(store.unsettledChecks(), [check.id]);
  assert.deepEqual(events(store), []);

  restore();
  assert.equal(store.settleReturned(check.id, { kind: "sent-back" }, 4_000, null), MANAGER);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 1, "the round claimed once");
  const settled = store.check(check.id)?.verdict;
  assert.deepEqual(settled?.state === "returned" && settled.settlement, { kind: "sent-back", round: 1, ci: { kind: "none" } });
  assert.deepEqual(store.unsettledChecks(), []);
  assert.deepEqual(events(store), [{ kind: "sent-back", issueId: issue.id, agentId, checkId: check.id, round: 1 }], "the manager is told once");
});

test("a settlement as checked that fails before the manager is told keeps its round claimed, and a retry releases it once", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(check.id, returned("thr_verifier_1", "fail"), 3_500);
  store.claimFixRound(check.id, { kind: "none" });
  const claimed = { kind: "sending-back", round: 1, ci: { kind: "none" } };
  const settlementOf = () => {
    const verdict = store.check(check.id)?.verdict;
    return verdict?.state === "returned" ? verdict.settlement : assert.fail("not returned");
  };
  const restore = failWrites(db, "INSERT", "events");
  assert.throws(() => store.settleReturned(check.id, CHECKED, 4_000, null), /forced failure/);
  assert.deepEqual([settlementOf(), store.agent(MANAGER, agentId)?.fixRounds, events(store)], [claimed, 1, []], "the claim and its round stand, and nobody is told");

  restore();
  assert.equal(store.settleReturned(check.id, CHECKED, 4_000, null), MANAGER);
  assert.deepEqual(settlementOf(), CHECKED);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 0, "the claimed round released once");
  assert.deepEqual(events(store), [{ kind: "checked", issueId: issue.id, checkId: check.id, asked: null }], "the manager is told once");
});

test("a verdict, a give-up or a CI result that arrives after its check settled or was superseded changes nothing", () => {
  const { store, issue, agentId } = withAgent();
  const running = (n: number) => ({ state: "running", verifierThreadId: `thr_verifier_${n}` }) as const;
  const gaveUp = (n: number) => ({ verifierThreadId: `thr_verifier_${n}`, reason: "its verifier stopped without a verdict" }) as const;

  const settled = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(settled.id, returned("thr_verifier_1", "pass"), 4_500);
  store.settleReturned(settled.id, CHECKED, 4_000, null);
  const final = store.check(settled.id)?.verdict;
  assert.equal(store.receiveVerdict(settled.id, returned("thr_verifier_1", "fail"), 4_500), false);
  assert.equal(store.giveUpCheck(settled.id, running(1), gaveUp(1), 4_100), null);
  assert.equal(store.settleReturned(settled.id, { kind: "sent-back" }, 4_100, null), null);
  assert.deepEqual(store.check(settled.id)?.verdict, final);

  const waiting = runningCheck(store, issue.id, agentId, 2);
  store.receiveVerdict(waiting.id, returned("thr_verifier_2", "pass"), 4_500);
  store.settleReturned(waiting.id, { kind: "waiting-for-ci" }, 4_200, null);
  const waited = store.check(waiting.id)?.verdict;
  const superseded = runningCheck(store, issue.id, agentId, 3);
  runningCheck(store, issue.id, agentId, 4);
  assert.equal(store.settleReturned(waiting.id, CHECKED, 4_300, null), null, "CI on a superseded commit");
  assert.equal(store.receiveVerdict(superseded.id, returned("thr_verifier_3", "pass"), 4_500), false);
  assert.equal(store.giveUpCheck(superseded.id, running(3), gaveUp(3), 4_300), null);
  assert.deepEqual([store.check(waiting.id)?.verdict, store.check(superseded.id)?.verdict], [{ ...waited, settlement: { kind: "superseded" } }, { state: "superseded" }]);
  assert.deepEqual(events(store), [{ kind: "checked", issueId: issue.id, checkId: settled.id, asked: null }]);
});

test("a review starts running as its reviewer's ticket binds, and takes its findings or its miss only from where it is, while its check waits", () => {
  const { store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertCheckerTicket("reviewer-1", { kind: "reviewer", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  assert.deepEqual(store.bindTicket("reviewer-1", "thr_reviewer"), { kind: "reviewer", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id });
  assert.deepEqual(store.check(check.id)?.review, { state: "running", reviewerThreadId: "thr_reviewer", scoped: true });
  assert.deepEqual(store.check(check.id)?.verdict, { state: "queued", checkout: CLEAN.checkout }, "its verifier is still to start");
  assert.equal(store.rescopeReview(check.id, "thr_other"), false, "only its running reviewer is given its scope");
  assert.equal(store.rescopeReview(check.id, "thr_reviewer"), true);
  assert.deepEqual(store.check(check.id)?.review, { state: "running", reviewerThreadId: "thr_reviewer", scoped: true });

  assert.equal(store.missReview(check.id, { state: "queued" }, "never started", 4_100), false, "it isn't queued any more");
  const finding = { file: "src/retry.ts", line: 4, severity: "should-fix", claim: "No cap.", origin: "new" } as const;
  const model = { providerId: "claude-code", model: "sonnet" };
  assert.equal(store.receiveReview(check.id, "thr_other", { findings: [finding], earlier: [] }, model, 4_200), false);
  assert.equal(store.receiveReview(check.id, "thr_reviewer", { findings: [finding], earlier: [] }, model, 4_200), true);
  assert.deepEqual(store.check(check.id)?.review, { state: "reported", at: 4_200, reviewerThreadId: "thr_reviewer", findings: [finding], earlier: [], model });
  assert.equal(store.receiveReview(check.id, "thr_reviewer", { findings: [], earlier: [] }, model, 4_200), false, "a second report changes nothing");
  assert.equal(store.missReview(check.id, { state: "running", reviewerThreadId: "thr_reviewer" }, "stalled", 4_100), false, "nor a late miss");
  assert.deepEqual(events(store), [], "nobody is told of a review");

  const next = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_100), CLEAN));
  store.insertCheckerTicket("reviewer-2", { kind: "reviewer", coordinatorId: MANAGER, issueId: issue.id, checkId: next.id }, 3_100);
  store.bindTicket("reviewer-2", "thr_reviewer_2");
  store.insertHandoff(handoff(issue.id, agentId, "done", 3_200), CLEAN);
  assert.equal(store.receiveReview(next.id, "thr_reviewer_2", { findings: [], earlier: [] }, model, 4_200), false, "its check was superseded");
  assert.deepEqual(store.check(next.id)?.review, { state: "running", reviewerThreadId: "thr_reviewer_2", scoped: true });
});

test("a reviewer's ticket whose review fails to start stays unbound, and binds once a retry's write succeeds", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertCheckerTicket("reviewer-1", { kind: "reviewer", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  const allow = failWrites(db, "UPDATE", "checks");
  assert.throws(() => store.bindTicket("reviewer-1", "thr_reviewer_1"), /forced failure/);
  assert.deepEqual([store.roleOfThread("thr_reviewer_1"), store.check(check.id)?.review], [null, { state: "queued" }]);
  allow();
  assert.equal(store.bindTicket("reviewer-1", "thr_reviewer_1")?.kind, "reviewer");
  assert.deepEqual(store.check(check.id)?.review, { state: "running", reviewerThreadId: "thr_reviewer_1", scoped: true });
});

test("a verifier's ticket that binds after its check was superseded leaves the check superseded", () => {
  const { store, issue, agentId } = withAgent();
  const stale = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_000), CLEAN));
  store.insertCheckerTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: stale.id }, 3_000);
  store.insertHandoff(handoff(issue.id, agentId, "done", 3_100), CLEAN);
  store.bindTicket("verifier-1", "thr_verifier_1");
  assert.deepEqual(store.check(stale.id)?.verdict, { state: "superseded" });
});

/** A build parent WEB-1 with a merged sub-issue WEB-2, its criteria and verifier named. */
function withParent() {
  const { db, store } = freshStore();
  const parent = filedIssue(store, MANAGER, newIssue({ title: "Card vault", doneCriteria: ["npm run vault-suite passes"], verifier: EXECUTION }), 2_000);
  const sub = filedIssue(store, MANAGER, newIssue({ parentId: parent.id }), 2_100);
  return { db, store, parent, sub };
}

test("a final check copies its parent's criteria and verifier, supersedes the one still open, and counts as a change as it is made, starts and returns", () => {
  const { store, parent, sub } = withParent();
  const writes = () => store.factWrites(MANAGER);
  const before = writes();
  const first = store.insertFinalCheck(MANAGER, parent.id, { defaultBranch: "main", merged: [sub.id] }, 4_000);
  assert.ok(writes() > before, "made");
  assert.deepEqual(
    { criteria: first.criteria, verifier: first.verifier, subject: first.subject, verdict: first.verdict },
    { criteria: ["npm run vault-suite passes"], verifier: EXECUTION, subject: { kind: "final", defaultBranch: "main", merged: [sub.id] }, verdict: { state: "queued", checkout: null } },
  );
  assert.deepEqual(events(store), [], "nobody is told until it has a verdict");

  store.insertCheckerTicket("final-1", { kind: "verifier", coordinatorId: MANAGER, issueId: parent.id, checkId: first.id }, 4_100);
  const queued = writes();
  store.bindTicket("final-1", "thr_final_1");
  assert.ok(writes() > queued, "started");
  const running = writes();
  assert.ok(store.receiveVerdict(first.id, { ...returned("thr_final_1", "pass"), headSha: "b".repeat(40), checkout: { headSha: "b".repeat(40), changedFiles: [], changedFileCount: 0 } }, 4_500));
  assert.ok(writes() > running, "returned");

  const second = store.insertFinalCheck(MANAGER, parent.id, { defaultBranch: "main", merged: [sub.id] }, 5_000);
  assert.deepEqual(
    store.finalChecks(MANAGER, parent.id).map(({ id, verdict }) => [id, verdict.state]),
    [
      [first.id, "returned"],
      [second.id, "queued"],
    ],
    "a returned one is kept as it is",
  );
  const third = store.insertFinalCheck(MANAGER, parent.id, { defaultBranch: "main", merged: [sub.id] }, 6_000);
  assert.deepEqual(
    store.finalChecks(MANAGER, parent.id).map(({ id, verdict }) => [id, verdict.state]),
    [
      [first.id, "returned"],
      [second.id, "superseded"],
      [third.id, "queued"],
    ],
  );
  assert.deepEqual(store.finalChecks(MANAGER, sub.id), [], "a handoff's check is no final check");
});

test("a final check made while verification is off is waived and announced at once; a failed announcement rolls back the supersede and the check with it", () => {
  const { db, store, parent, sub } = withParent();
  const open = store.insertFinalCheck(MANAGER, parent.id, { defaultBranch: "main", merged: [sub.id] }, 4_000);
  store.setVerify(MANAGER, false, 4_500);
  const seen = events(store).length;

  const allow = failWrites(db, "INSERT", "events");
  assert.throws(() => store.insertFinalCheck(MANAGER, parent.id, { defaultBranch: "main", merged: [sub.id] }, 5_000), /forced failure/);
  assert.deepEqual(
    store.finalChecks(MANAGER, parent.id).map(({ id, verdict }) => [id, verdict.state]),
    [[open.id, "queued"]],
    "nothing of it was written",
  );
  allow();

  const waived = store.insertFinalCheck(MANAGER, parent.id, { defaultBranch: "main", merged: [sub.id] }, 5_000);
  assert.deepEqual(waived.verdict, { state: "waived" });
  assert.deepEqual(events(store).slice(seen), [{ kind: "checked", issueId: parent.id, checkId: waived.id, asked: null }]);
  assert.equal(store.check(open.id)?.verdict.state, "superseded");
});

test("a third failure that settles asks the user at the cap in the same transaction: a failed question's insert undoes the settlement, and a retry asks exactly once", () => {
  const { db, store, issue, agentId } = withAgent();
  const failedOnce = (n: number) => {
    const check = runningCheck(store, issue.id, agentId, n);
    store.receiveVerdict(check.id, returned(`thr_verifier_${n}`, "fail"), 4_000 + n);
    return check;
  };
  for (const n of [1, 2]) assert.equal(store.settleReturned(failedOnce(n).id, CHECKED, 4_500 + n, null), MANAGER);
  assert.deepEqual(store.decisions(MANAGER), [], "two failures ask nothing");
  const third = failedOnce(3);
  const before = events(store);

  const restore = failWrites(db, "INSERT", "decisions");
  assert.throws(() => store.settleReturned(third.id, CHECKED, 4_600, null), /forced failure/);
  assert.deepEqual(store.unsettledChecks(), [third.id], "the settlement was undone");
  assert.deepEqual(events(store), before, "and nobody was told");
  assert.deepEqual(store.decisions(MANAGER), []);

  restore();
  assert.equal(store.settleReturned(third.id, CHECKED, 4_600, null), MANAGER);
  assert.equal(store.settleReturned(third.id, CHECKED, 4_700, null), null, "settled once");
  const settled = store.check(third.id)?.verdict;
  assert.deepEqual(settled?.state === "returned" && settled.settlement, CHECKED);
  const [asked = assert.fail("nothing asked"), ...more] = store.decisions(MANAGER);
  assert.deepEqual(more, [], "exactly one question");
  const { question, ...rest } = asked;
  assert.deepEqual(rest, { id: "d1", issueId: issue.id, options: ["Merge as is, file follow-ups", "One more round", "Cancel the issue"], askedAt: 4_600, answer: null, cap: 3 });
  assert.match(question, /^✗ Failed verification, 0 of 1 criteria passed\. WEB-1 has failed verification 3 times, its cap, /, "it leads with the failure's reason and how many criteria passed, then the count");
  assert.ok(question.length < 500);
});

test("a third failure whose send-back a reload cut short settles as maybe sent back and still asks at the cap, its fix round kept", () => {
  const { store, issue, agentId } = withAgent();
  const returnedOnce = (n: number) => {
    const check = runningCheck(store, issue.id, agentId, n);
    store.receiveVerdict(check.id, returned(`thr_verifier_${n}`, "fail"), 4_000 + n);
    return check;
  };
  for (const n of [1, 2]) store.settleReturned(returnedOnce(n).id, CHECKED, 4_500 + n, null);
  const third = returnedOnce(3);
  store.claimFixRound(third.id, { kind: "none" });
  assert.equal(store.settleReturned(third.id, { kind: "maybe-sent-back" }, 4_600, null), MANAGER);

  const settled = store.check(third.id)?.verdict;
  assert.deepEqual(settled?.state === "returned" && settled.settlement, { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } });
  assert.deepEqual(store.decisions(MANAGER).map(({ id, cap }) => [id, cap]), [["d1", 3]]);
  assert.deepEqual(events(store).at(-1), { kind: "checked", issueId: issue.id, checkId: third.id, asked: "d1" });
});

test("the question stays with the failure whose settling asked it, whatever order the failures settle in: round 4 asks while round 3 waits on a failed write, and round 3's retry asks nothing", () => {
  const { db, store, issue, agentId } = withAgent();
  const returnedOnce = (n: number) => {
    const check = runningCheck(store, issue.id, agentId, n);
    store.receiveVerdict(check.id, returned(`thr_verifier_${n}`, "fail"), 4_000 + n);
    return check;
  };
  for (const n of [1, 2]) store.settleReturned(returnedOnce(n).id, CHECKED, 4_500 + n, null);
  const third = returnedOnce(3);
  const restore = failWrites(db, "INSERT", "decisions");
  assert.throws(() => store.settleReturned(third.id, CHECKED, 4_600, null), /forced failure/);
  restore();
  const fourth = returnedOnce(4);
  assert.equal(store.settleReturned(fourth.id, CHECKED, 4_700, null), MANAGER, "round 4 settles as the third counted failure, and asks");
  assert.equal(store.settleReturned(third.id, CHECKED, 4_800, null), MANAGER, "round 3's retry settles as the fourth, while the question is open");

  assert.deepEqual(store.decisions(MANAGER).map(({ id, cap }) => [id, cap]), [["d1", 3]], "one question");
  const asked = events(store).flatMap((event) => (event.kind === "checked" ? [[event.checkId, event.asked]] : []));
  assert.deepEqual(asked.slice(-2), [[fourth.id, "d1"], [third.id, null]], "round 4's settling asked d1; round 3's asked nothing");
});

const LOG_IT: Finding = { file: "src/retry.ts", line: 10, severity: "should-fix", claim: "Log each retry.", origin: "new" };
const NAME_IT: Finding = { file: "src/retry.ts", line: 3, severity: "nit", claim: "Name the constant.", origin: "new" };

type Triage = Received["triage"][number];
const confirmed = (reason: string): Triage => ({ result: "confirmed", reason });
const toShouldFix: Triage = { result: "downgraded", to: "should-fix", reason: "No criterion names a cap." };

/** A round of the issue: a done handoff whose reviewer reported `findings`, returned with each criterion `result` and the verifier's `triage`, not yet settled. */
function roundWith(store: Store, issueId: IssueId, agentId: AgentId, n: number, findings: Finding[], result: "pass" | "fail", triage: Triage[]): Check {
  const check = reviewedWith(store, issueId, agentId, n, findings);
  assert.equal(store.receiveVerdict(check.id, { ...returned(`thr_verifier_${n}`, result), triage }, 4_000 + n), true);
  return check;
}

/** Two rounds of WEB-1: the first failed its criteria holding a should-fix and a nit, the second passed holding a must-fix downgraded to a should-fix and the first's should-fix again; the first settled. */
function passWithLeftovers() {
  const made = withAgent();
  const { store, issue, agentId } = made;
  const first = roundWith(store, issue.id, agentId, 1, [LOG_IT, NAME_IT], "fail", [confirmed("Nobody sees a retry."), confirmed("It reads better.")]);
  assert.equal(store.settleReturned(first.id, CHECKED, 4_500, null), MANAGER);
  assert.equal(store.issues(MANAGER).length, 1, "a failure files nothing");
  const second = roundWith(store, issue.id, agentId, 2, [CAPLESS, LOG_IT], "pass", [toShouldFix, confirmed("Still no log.")]);
  return { ...made, first, second };
}

const followUpsOf = (store: Store, checks: readonly Check[]) => checks.map(({ id }) => store.check(id)?.followUpId);

test("a pass with leftovers in two rounds files one top-level Backlog build issue, no done-criteria, depending on its origin, whose brief lists each finding once, and stamps both checks; a second settle files none", () => {
  const { store, issue, agentId, first, second } = passWithLeftovers();
  assert.equal(store.settleReturned(second.id, CHECKED, 4_600, null), MANAGER);

  const [, filed = assert.fail("no follow-up filed"), ...more] = store.issues(MANAGER);
  assert.deepEqual(more, [], "one follow-up");
  const { brief, description, ...plan } = filed;
  assert.deepEqual(plan, {
    id: "WEB-2",
    coordinatorId: MANAGER,
    kind: "build",
    title: "Follow-ups from WEB-1: Add retries",
    doneCriteria: [],
    verifier: null,
    rest: "backlog",
    parentId: null,
    dependsOn: [issue.id],
    closed: null,
    createdAt: 4_600,
  });
  assert.match(description, /^3 review findings held without blocking WEB-1 when it passed\. Its brief lists each/);
  const listed = brief ?? assert.fail("no brief");
  for (const claim of [LOG_IT.claim, NAME_IT.claim, CAPLESS.claim]) assert.equal(listed.split(claim).length - 1, 1, `${claim} is listed once`);
  assert.match(listed, /- Round 2: `src\/retry.ts:10` \(should-fix\): Log each retry\.\n {2}The verifier: Confirmed\. Still no log\./);
  assert.match(listed, /- Round 1: `src\/retry.ts:3` \(nit\): Name the constant\./);
  assert.match(listed, /- Round 2: `src\/retry.ts:42` \(must-fix\): The backoff never caps\.\n {2}The verifier: Downgraded to should-fix\. No criterion names a cap\./);
  assert.deepEqual(followUpsOf(store, [first, second]), ["WEB-2", "WEB-2"], "both checks are stamped");

  assert.equal(store.settleReturned(second.id, CHECKED, 4_700, null), null, "settled once");
  const third = roundWith(store, issue.id, agentId, 3, [NAME_IT], "pass", [confirmed("It reads better.")]);
  store.settleReturned(third.id, CHECKED, 4_800, null);
  assert.equal(store.issues(MANAGER).length, 2, "a later pass collects no round twice, and its nit alone files nothing");
  assert.deepEqual(followUpsOf(store, [third]), [null]);
});

test("a pass with only nits left files none and stamps nothing, and neither does a pass with none", () => {
  const { store, issue, agentId } = withAgent();
  const nits = roundWith(store, issue.id, agentId, 1, [NAME_IT, { ...LOG_IT, claim: "Split the module." }], "pass", [confirmed("It reads better."), { result: "downgraded", to: "nit", reason: "Taste." }]);
  assert.equal(store.settleReturned(nits.id, CHECKED, 4_600, null), MANAGER);
  assert.deepEqual(store.issues(MANAGER).map(({ id }) => id), [issue.id]);
  assert.deepEqual(followUpsOf(store, [nits]), [null]);
});

test("a follow-up of a follow-up is titled after the first origin and depends on its own", () => {
  const { store, second } = passWithLeftovers();
  store.settleReturned(second.id, CHECKED, 4_600, null);
  const followUp = issueIdSchema.parse("WEB-2");
  const agentId = startAgent(store, followUp, "agent-2");
  const round = roundWith(store, followUp, agentId, 3, [LOG_IT], "pass", [confirmed("Still no log.")]);
  store.settleReturned(round.id, CHECKED, 4_900, null);
  const filed = store.issue(MANAGER, issueIdSchema.parse("WEB-3"));
  assert.deepEqual(filed && [filed.title, filed.dependsOn], ["Follow-ups from WEB-1: Add retries", [followUp]]);
});

test("a pass whose follow-up's insert fails undoes the settlement and every other write, and a retry files exactly one follow-up", () => {
  const { db, store, first, second } = passWithLeftovers();
  const before = events(store);
  const restore = failWrites(db, "INSERT", "issues");
  assert.throws(() => store.settleReturned(second.id, CHECKED, 4_600, null), /forced failure/);
  assert.deepEqual(store.unsettledChecks(), [second.id], "the settlement was undone");
  assert.deepEqual(events(store), before, "and nobody was told");
  assert.equal(store.issues(MANAGER).length, 1);
  assert.deepEqual(followUpsOf(store, [first, second]), [null, null]);

  restore();
  assert.equal(store.settleReturned(second.id, CHECKED, 4_600, null), MANAGER);
  assert.deepEqual(store.issues(MANAGER).map(({ id }) => id), ["WEB-1", "WEB-2"]);
  assert.deepEqual(followUpsOf(store, [first, second]), ["WEB-2", "WEB-2"]);
});

test("a pass whose stamp of a check's follow-up fails undoes the settlement, the follow-up and its dependency, and a retry files exactly one follow-up", () => {
  const { db, store, issue, first, second } = passWithLeftovers();
  const before = events(store);
  const restore = failWrites(db, "UPDATE", "checks", `NEW.follow_up_id IS NOT NULL AND NEW.id = '${second.id}'`);
  assert.throws(() => store.settleReturned(second.id, CHECKED, 4_600, null), /forced failure/);
  assert.deepEqual(store.unsettledChecks(), [second.id], "the settlement was undone");
  assert.deepEqual(events(store), before, "and nobody was told");
  assert.deepEqual(store.issues(MANAGER).map(({ id }) => id), [issue.id], "the follow-up was undone");
  assert.deepEqual(db.prepare("SELECT issue_id, depends_on FROM issue_relations").all(), [], "and its dependency");
  assert.deepEqual(followUpsOf(store, [first, second]), [null, null], "the first check's stamp was undone too");

  restore();
  assert.equal(store.settleReturned(second.id, CHECKED, 4_600, null), MANAGER);
  assert.deepEqual(store.issues(MANAGER).map(({ id, dependsOn }) => [id, dependsOn]), [[issue.id, []], ["WEB-2", [issue.id]]]);
  assert.deepEqual(followUpsOf(store, [first, second]), ["WEB-2", "WEB-2"]);
});

/** The close the follow-up's relation to its origin starts knowing (issues-store.ts writeDependencies): null while it was open as the pass settled. */
const knownClose = (db: ReturnType<typeof freshStore>["db"], followUp: string) =>
  db.prepare("SELECT known_close AS close FROM issue_relations WHERE issue_id = ?").get(followUp);

/** Every issue of MANAGER viewed as the board would with no agent placing it, WEB-1's pull request `#41` merged when `merged`. */
const viewsWith = (store: Store, merged: boolean) =>
  issueViews(store.issues(MANAGER).map((issue) => ({ issue, holder: null, ended: null, accepted: null, pr: merged && issue.id === "WEB-1" ? MERGED_41 : null, openDecisions: [], finalCheck: null, verifierAsks: false })));
const MERGED_41: PrSnapshot = { number: 41, url: "https://github.com/acme/webhooks/pull/41", state: "merged", draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] };
const unblockedEvents = (store: Store) => events(store).filter(({ kind }) => kind === "unblocked");

test("a pass settled on a merged pull request files its follow-up knowing the origin closed by that merge, so recordUnblocked announces nothing; one settled before the merge is announced once when it merges", () => {
  const merged = passWithLeftovers();
  assert.equal(merged.store.settleReturned(merged.second.id, CHECKED, 4_600, 41), MANAGER);
  assert.deepEqual(knownClose(merged.db, "WEB-2"), { close: "merged #41" }, "the close the origin's view derives (status.ts finalOf)");
  assert.equal(merged.store.recordUnblocked(MANAGER, viewsWith(merged.store, true), 4_700), false);
  assert.deepEqual(unblockedEvents(merged.store), [], "an origin merged before its pass is no news");

  const open = passWithLeftovers();
  open.store.settleReturned(open.second.id, CHECKED, 4_600, null);
  assert.deepEqual(knownClose(open.db, "WEB-2"), { close: null });
  assert.equal(open.store.recordUnblocked(MANAGER, viewsWith(open.store, true), 4_700), true);
  assert.equal(open.store.recordUnblocked(MANAGER, viewsWith(open.store, true), 4_800), false);
  assert.deepEqual(unblockedEvents(open.store), [{ kind: "unblocked", issueId: "WEB-2", by: "WEB-1", closedAs: "done" }], "a merge after the pass unblocks it, announced once");
});

test("a build parent whose own handoff left a should-fix files its follow-up when its final check passes, stamping both checks and knowing the parent closed by that check", () => {
  const { db, store, issue, agentId } = withAgent();
  const failed = roundWith(store, issue.id, agentId, 1, [LOG_IT], "fail", [confirmed("Nobody sees a retry.")]);
  store.settleReturned(failed.id, CHECKED, 4_500, null);
  store.endAgent({ coordinatorId: MANAGER, id: agentId, issueId: issue.id }, "stopped", null, false, 4_550);
  const sub = filedIssue(store, MANAGER, newIssue({ parentId: issue.id }), 4_560);
  const final = store.insertFinalCheck(MANAGER, issue.id, { defaultBranch: "main", merged: [sub.id] }, 5_000);
  store.insertCheckerTicket("final-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: final.id }, 5_000);
  store.bindTicket("final-1", "thr_final_1");
  assert.ok(store.receiveVerdict(final.id, returned("thr_final_1", "pass"), 5_100));
  assert.equal(store.settleReturned(final.id, CHECKED, 5_200, null), MANAGER);

  const followUp = store.issue(MANAGER, issueIdSchema.parse("WEB-3")) ?? assert.fail("no follow-up filed");
  assert.deepEqual([followUp.title, followUp.parentId, followUp.dependsOn, followUp.rest], ["Follow-ups from WEB-1: Add retries", null, [issue.id], "backlog"]);
  assert.match(followUp.brief ?? "", /- Round 1: `src\/retry.ts:10` \(should-fix\): Log each retry\./);
  assert.deepEqual(followUpsOf(store, [failed, final]), ["WEB-3", "WEB-3"]);
  assert.deepEqual(knownClose(db, "WEB-3"), { close: `final check ${final.id}` });
});

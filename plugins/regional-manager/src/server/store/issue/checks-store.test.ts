import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AgentId } from "../../../model/agent.ts";
import { handoffIdSchema, type NextHandoff } from "../../../model/handoff.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { Check } from "../../../model/verdict/check.ts";
import type { CheckoutRead } from "../../../model/verdict/checkout.ts";
import { openStore, type Store } from "../store.ts";
import { EXECUTION, failWrites, freshStore, MANAGER, newIssue, startAgent } from "../test-store.ts";

const SHA = "a".repeat(40);
const CLEAN: CheckoutRead = { kind: "read", checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 } };
const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };

function handoff(issueId: IssueId, agentId: AgentId, status: "done" | "blocked", at = 3_000): NextHandoff {
  const made = { id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId, agentId, at, turnSeq: 1 };
  return status === "done" ? { ...made, ...report, status, delivery: { kind: "commit", headSha: SHA, prUrl: null } } : { ...made, ...report, status };
}

function withAgent() {
  const { db, storage, store } = freshStore();
  const issue = store.insertIssue(MANAGER, newIssue({ doneCriteria: ["npm test passes", "npm run lint passes"], verifier: EXECUTION }), 2_000);
  return { db, storage, store, issue, agentId: startAgent(store, issue.id, "agent-1") };
}

function checkOf(made: { check: Check | null }): Check {
  return made.check ?? assert.fail("the done handoff made no check");
}

type Received = Parameters<Store["receiveVerdict"]>[1];

const returned = (verifierThreadId: string, result: "pass" | "fail"): Received => ({
  state: "returned",
  verifierThreadId,
  headSha: SHA,
  criteria: [{ criterion: "npm test passes", result, evidence: "npm test" }],
  findings: [],
  model: { providerId: "claude-code", model: "sonnet" },
  sameModel: false,
});

/** A done handoff's check, running in the verifier thread `thr_verifier_<n>`. */
function runningCheck(store: Store, issueId: IssueId, agentId: AgentId, n: number): Check {
  const check = checkOf(store.insertHandoff(handoff(issueId, agentId, "done", 3_000 + n), CLEAN));
  store.insertVerifierTicket(`verifier-${n}`, { kind: "verifier", coordinatorId: MANAGER, issueId, checkId: check.id }, 3_000);
  store.bindTicket(`verifier-${n}`, `thr_verifier_${n}`);
  return check;
}

const CHECKED = { kind: "checked", refused: null, ci: { kind: "none" } } as const;

const events = (store: Store) => store.unannounced(MANAGER).map(({ event }) => event);

test("a done handoff makes a queued check that copies its issue's criteria and verifier as they are then, and tells nobody yet", () => {
  const { store, issue, agentId } = withAgent();
  const done = handoff(issue.id, agentId, "done");
  const check = checkOf(store.insertHandoff(done, CLEAN));

  store.updateIssue(MANAGER, issue.id, { doneCriteria: ["npm test passes"], verifier: null }, { requireUnheld: false });

  assert.deepEqual(store.check(check.id), {
    id: check.id,
    coordinatorId: MANAGER,
    issueId: issue.id,
    at: 3_000,
    criteria: ["npm test passes", "npm run lint passes"],
    verifier: EXECUTION,
    subject: { kind: "handoff", agentId, handoffId: done.id, headSha: SHA, prUrl: null },
    verdict: { state: "queued", checkout: CLEAN.checkout },
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
    { kind: "checked", issueId: issue.id, checkId: waived.id },
    { kind: "verification-toggled", verify: true },
    { kind: "checked", issueId: issue.id, checkId: unread.id },
  ]);
});

test("a blocked handoff gets no check and is announced at once", () => {
  const { store, issue, agentId } = withAgent();
  const blocked = handoff(issue.id, agentId, "blocked");
  assert.deepEqual(store.insertHandoff(blocked, CLEAN), { check: null, superseded: [] });
  assert.deepEqual(events(store), [{ kind: "handoff", issueId: issue.id, agentId, handoffId: blocked.id, status: "blocked" }]);
});

test("a newer done handoff supersedes the agent's checks still waiting, and returns the verifiers to stop", () => {
  const { store, issue, agentId } = withAgent();
  const queued = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_000), CLEAN));
  const running = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_100), CLEAN));
  store.insertVerifierTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: running.id }, 3_100);
  store.bindTicket("verifier-1", "thr_verifier");

  const newest = store.insertHandoff(handoff(issue.id, agentId, "done", 3_200), CLEAN);

  assert.deepEqual(newest.superseded, ["thr_verifier"]);
  assert.deepEqual([store.check(queued.id)?.verdict, store.check(running.id)?.verdict], [{ state: "superseded" }, { state: "superseded" }]);
  assert.deepEqual(store.openChecks().map(({ id }) => id), [checkOf(newest).id]);
  assert.deepEqual(store.record(MANAGER, issue.id).map(({ check }) => check?.verdict.state), ["superseded", "superseded", "queued"]);
});

test("a check starts running as its verifier's ticket binds, is nudged once, and is given up only from where it is", () => {
  const { store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertVerifierTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  assert.deepEqual(store.bindTicket("verifier-1", "thr_verifier"), { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id });
  assert.deepEqual(store.check(check.id)?.verdict, { state: "running", verifierThreadId: "thr_verifier", nudged: false, checkout: CLEAN.checkout });

  assert.equal(store.markNudged(check.id, "thr_verifier"), true);
  assert.equal(store.markNudged(check.id, "thr_verifier"), false);

  const gaveUp = { state: "could-not-run", verifierThreadId: "thr_verifier", reason: "its verifier stopped without a verdict" } as const;
  assert.equal(store.giveUpCheck(check.id, { state: "queued" }, gaveUp, 4_000), null, "it isn't queued any more");
  assert.equal(store.giveUpCheck(check.id, { state: "running", verifierThreadId: "thr_verifier" }, gaveUp, 4_000), MANAGER);
  assert.deepEqual(store.check(check.id)?.verdict, gaveUp);
  assert.deepEqual(events(store), [{ kind: "checked", issueId: issue.id, checkId: check.id }]);
});

test("a fix round claimed before its findings are sent survives a reload, and settles once, with the event that says it was sent back", () => {
  const { storage, store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertVerifierTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  store.bindTicket("verifier-1", "thr_verifier");
  const failed: Received = {
    state: "returned",
    verifierThreadId: "thr_verifier",
    headSha: SHA,
    criteria: [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }],
    findings: [],
    model: { providerId: "claude-code", model: "sonnet" },
    sameModel: false,
  };
  assert.equal(store.receiveVerdict(check.id, { ...failed, verifierThreadId: "thr_other" }), false, "only its running verifier's verdict is taken");
  assert.equal(store.receiveVerdict(check.id, failed), true);
  assert.deepEqual(store.unsettledChecks(), [check.id]);
  store.claimFixRound(check.id, { kind: "none" });

  const reloaded = openStore(storage);
  assert.equal(reloaded.agent(MANAGER, agentId)?.fixRounds, 1);
  assert.equal(reloaded.settleReturned(check.id, { kind: "sent-back" }, 4_000), MANAGER);
  assert.equal(reloaded.settleReturned(check.id, { kind: "sent-back" }, 4_000), null, "settled once");
  assert.deepEqual(reloaded.unsettledChecks(), []);
  assert.deepEqual(events(reloaded), [{ kind: "sent-back", issueId: issue.id, agentId, checkId: check.id, round: 1 }]);
});

test("a verdict that passed waits for CI, and one settled as checked gives back a round claimed for findings that never left", () => {
  const { store, issue, agentId } = withAgent();

  const passed = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(passed.id, returned("thr_verifier_1", "pass"));
  assert.equal(store.settleReturned(passed.id, { kind: "waiting-for-ci" }, 4_000), MANAGER);
  assert.deepEqual(store.waitingForCi(MANAGER, agentId), [passed.id]);
  assert.deepEqual(events(store), [], "nobody is told while it waits for CI");

  const failed = runningCheck(store, issue.id, agentId, 2);
  assert.deepEqual(store.check(passed.id)?.verdict, { state: "superseded" }, "a newer done handoff supersedes one waiting for CI");
  store.receiveVerdict(failed.id, returned("thr_verifier_2", "fail"));
  store.claimFixRound(failed.id, { kind: "none" });
  assert.equal(store.settleReturned(failed.id, { kind: "checked", refused: "bb refused the message", ci: { kind: "none" } }, 4_100), MANAGER);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 0);
  assert.deepEqual(events(store), [{ kind: "checked", issueId: issue.id, checkId: failed.id }]);
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

test("a verifier's ticket whose check fails to start stays unbound", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done"), CLEAN));
  store.insertVerifierTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: check.id }, 3_000);
  failWrites(db, "UPDATE", "checks");
  assert.throws(() => store.bindTicket("verifier-1", "thr_verifier_1"), /forced failure/);
  assert.equal(store.roleOfThread("thr_verifier_1"), null);
});

test("a check given up that fails before the manager is told keeps running", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = runningCheck(store, issue.id, agentId, 1);
  failWrites(db, "INSERT", "events");
  const gaveUp = { state: "could-not-run", verifierThreadId: "thr_verifier_1", reason: "its verifier stopped without a verdict" } as const;
  assert.throws(() => store.giveUpCheck(check.id, { state: "running", verifierThreadId: "thr_verifier_1" }, gaveUp, 4_000), /forced failure/);
  assert.equal(store.check(check.id)?.verdict.state, "running");
});

test("a fix round whose claim fails partway is not counted", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(check.id, returned("thr_verifier_1", "fail"));
  failWrites(db, "UPDATE", "checks");
  assert.throws(() => store.claimFixRound(check.id, { kind: "none" }), /forced failure/);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 0);
});

test("a settlement that fails before the manager is told leaves the verdict unsettled and its round claimed", () => {
  const { db, store, issue, agentId } = withAgent();
  const check = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(check.id, returned("thr_verifier_1", "fail"));
  store.claimFixRound(check.id, { kind: "none" });
  failWrites(db, "INSERT", "events");
  assert.throws(() => store.settleReturned(check.id, CHECKED, 4_000), /forced failure/);
  assert.equal(store.agent(MANAGER, agentId)?.fixRounds, 1);
  assert.deepEqual(store.unsettledChecks(), [check.id]);
});

test("a verdict, a give-up or a CI result that arrives after its check settled or was superseded changes nothing", () => {
  const { store, issue, agentId } = withAgent();
  const running = (n: number) => ({ state: "running", verifierThreadId: `thr_verifier_${n}` }) as const;
  const gaveUp = (n: number) => ({ state: "could-not-run", verifierThreadId: `thr_verifier_${n}`, reason: "its verifier stopped without a verdict" }) as const;

  const settled = runningCheck(store, issue.id, agentId, 1);
  store.receiveVerdict(settled.id, returned("thr_verifier_1", "pass"));
  store.settleReturned(settled.id, CHECKED, 4_000);
  const final = store.check(settled.id)?.verdict;
  assert.equal(store.receiveVerdict(settled.id, returned("thr_verifier_1", "fail")), false);
  assert.equal(store.giveUpCheck(settled.id, running(1), gaveUp(1), 4_100), null);
  assert.equal(store.settleReturned(settled.id, { kind: "sent-back" }, 4_100), null);
  assert.deepEqual(store.check(settled.id)?.verdict, final);

  const waiting = runningCheck(store, issue.id, agentId, 2);
  store.receiveVerdict(waiting.id, returned("thr_verifier_2", "pass"));
  store.settleReturned(waiting.id, { kind: "waiting-for-ci" }, 4_200);
  const superseded = runningCheck(store, issue.id, agentId, 3);
  runningCheck(store, issue.id, agentId, 4);
  assert.equal(store.settleReturned(waiting.id, CHECKED, 4_300), null, "CI on a superseded commit");
  assert.equal(store.receiveVerdict(superseded.id, returned("thr_verifier_3", "pass")), false);
  assert.equal(store.giveUpCheck(superseded.id, running(3), gaveUp(3), 4_300), null);
  assert.deepEqual([store.check(waiting.id)?.verdict, store.check(superseded.id)?.verdict], [{ state: "superseded" }, { state: "superseded" }]);
  assert.deepEqual(events(store), [{ kind: "checked", issueId: issue.id, checkId: settled.id }]);
});

test("a verifier's ticket that binds after its check was superseded leaves the check superseded", () => {
  const { store, issue, agentId } = withAgent();
  const stale = checkOf(store.insertHandoff(handoff(issue.id, agentId, "done", 3_000), CLEAN));
  store.insertVerifierTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId: issue.id, checkId: stale.id }, 3_000);
  store.insertHandoff(handoff(issue.id, agentId, "done", 3_100), CLEAN);
  store.bindTicket("verifier-1", "thr_verifier_1");
  assert.deepEqual(store.check(stale.id)?.verdict, { state: "superseded" });
});

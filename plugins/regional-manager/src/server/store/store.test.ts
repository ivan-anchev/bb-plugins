import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema, type Handoff } from "../../model/handoff.ts";
import { issueViews } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { memoryStorage } from "../memory-storage.ts";
import type { NewAgent } from "./issue/agents-store.ts";
import { openStore } from "./store.ts";
import { EXECUTION, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "./test-store.ts";

test("a fresh database holds the design's tables and indexes, and nothing else", () => {
  const { db } = freshStore();
  const names = (type: string) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(type)
      .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.deepEqual(names("table"), ["agents", "checks", "coordinators", "decisions", "doorbells", "events", "handoffs", "issue_relations", "issues", "memory_revisions", "pr_snapshots", "reminders", "roles"]);
  assert.deepEqual(names("index"), [
    "agents_holding",
    "checks_of_issue",
    "checks_open",
    "checks_unsettled",
    "decisions_of_coordinator",
    "events_own_tree",
    "events_unread",
    "handoffs_of_agent",
    "handoffs_of_issue",
    "issue_relations_blocks",
    "issues_of_parent",
    "reminders_due",
    "reminders_of_coordinator",
  ]);
});

test("a store opened again, as after a reload, keeps what was stored", () => {
  const { storage, store } = freshStore();
  const filed = filedIssue(store, MANAGER, newIssue(), 2_000);
  assert.deepEqual(openStore(storage).issue(MANAGER, filed.id), filed);
});

test("a ticket binds once: a second bind, to the same or another thread, changes nothing", () => {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: MANAGER, ticket: "ticket-1", projectId: "prj_1", verify: true, createdAt: 1_000 });
  assert.deepEqual(store.bindTicket("ticket-1", "thr_a"), { kind: "coordinator", coordinatorId: MANAGER });
  assert.equal(store.bindTicket("ticket-1", "thr_a"), null);
  assert.equal(store.bindTicket("ticket-1", "thr_b"), null);
  assert.deepEqual(store.roleOfThread("thr_a"), { kind: "coordinator", coordinatorId: MANAGER });
  assert.equal(store.roleOfThread("thr_b"), null);
});

test("a regional manager is listed once its thread is bound, and its unbound ticket configures only while unbound", () => {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: MANAGER, ticket: "ticket-1", projectId: "prj_1", verify: true, createdAt: 1_000 });
  assert.deepEqual(store.coordinators(), []);
  assert.equal(store.coordinator(MANAGER), null);
  assert.equal(store.isCoordinator(MANAGER), true);
  assert.equal(store.roleFor("thr_a", "ticket-1")?.kind, "coordinator");

  store.bindTicket("ticket-1", "thr_a");
  assert.deepEqual(store.coordinators(), [{ id: MANAGER, threadId: "thr_a", projectId: "prj_1", verify: true, createdAt: 1_000 }]);
  assert.equal(store.roleFor("thr_b", "ticket-1"), null);
});

test("removing a regional manager removes everything it owns, and nothing of another's", () => {
  const { store } = freshStore();
  for (const manager of [MANAGER, OTHER_MANAGER]) {
    const { id } = filedIssue(store, manager, newIssue(), 2_000);
    const agentId = startAgent(store, id, `agent-of-${manager}`, manager);
    store.insertHandoff(
      { id: handoffIdSchema.parse(randomUUID()), coordinatorId: manager, issueId: id, agentId, at: 3_000, turnSeq: 1, status: "blocked", summary: "Stuck", did: [], evidence: [], concerns: [], deviations: [], findings: [] },
      { kind: "unread", reason: "unused" },
    );
    store.insertDecision(manager, { question: "Which queue?", options: [], issueId: id }, 3_000);
    store.insertReminder(manager, { note: "Look again", dueAt: 9_000, everyMs: null });
    store.memoryRevision(manager, memoryFileSchema.parse("MEMORY.md"), "v1");
    store.savePrRead(manager, "bb/retries", { issueId: id, agentId }, null, null, 3_000);
    filedIssue(store, manager, { ...newIssue(), dependsOn: [id] }, 3_000);
    store.recordUnblocked(manager, issueViews(store.issues(manager).map((issue) => ({ issue, holder: null, ended: null, pr: null, openDecision: false }))), 3_000);
  }

  store.removeCoordinator(MANAGER);

  assert.equal(store.isCoordinator(MANAGER), false);
  assert.deepEqual(store.issues(MANAGER), []);
  assert.deepEqual(store.agents(MANAGER), []);
  assert.deepEqual(store.decisions(MANAGER), []);
  assert.deepEqual(store.reminders(MANAGER), []);
  assert.equal(store.roleOfThread("thr_manager_1"), null);
  assert.equal(store.roleOfThread(`thr_agent-of-${MANAGER}`), null);
  assert.equal(store.prOfBranch(MANAGER, "bb/retries"), null);
  assert.equal(store.hasDependencies(MANAGER), false);
  assert.deepEqual(store.coordinatorsToRing(), [OTHER_MANAGER]);

  assert.equal(store.issues(OTHER_MANAGER).length, 2);
  assert.equal(store.agents(OTHER_MANAGER).length, 1);
  assert.equal(store.decisions(OTHER_MANAGER).length, 1);
  assert.equal(store.hasDependencies(OTHER_MANAGER), true);
  assert.equal(store.roleOfThread("thr_manager_2")?.kind, "coordinator");
});

/** a1 holding i1 with a done handoff whose check runs in `thr_verifier`, and a2 as a handover would insert it. */
function handingOver() {
  const { db, store } = freshStore();
  const { id: issueId } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const holder = { coordinatorId: MANAGER, id: startAgent(store, issueId, "agent-1"), issueId };
  const handoffId = handoffIdSchema.parse(randomUUID());
  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const done: Handoff = { id: handoffId, coordinatorId: MANAGER, issueId, agentId: holder.id, at: 3_000, turnSeq: 1, ...report, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } };
  const check = store.insertHandoff(done, { kind: "read", checkout: { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 } }) ?? assert.fail("no check");
  store.insertVerifierTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId, checkId: check.id }, 3_000);
  store.bindTicket("verifier-1", "thr_verifier");
  const next: NewAgent = { coordinatorId: MANAGER, issueId, ticket: "agent-2", placement: { kind: "worktree" }, base: { kind: "joined", from: holder.id }, checkout: { environmentId: "env_1", branch: "bb/a1", head: null }, execution: EXECUTION, at: 4_000 };
  return { db, store, holder, handoffId, check, next };
}

test("a handover ends the holder as replaced with what it left, supersedes its waiting check and inserts the new agent with its inherited checkout, together", () => {
  const { store, holder, handoffId, check, next } = handingOver();
  assert.equal(store.replaceAgent(holder, handoffId, next), "a2");
  const [a1, a2] = store.agents(MANAGER);
  assert.deepEqual(a1?.ended, { how: "replaced", at: 4_000, left: handoffId });
  assert.deepEqual([a2?.base, a2?.checkout, a2?.ended], [{ kind: "joined", from: "a1" }, { environmentId: "env_1", branch: "bb/a1", head: null }, null]);
  assert.deepEqual(store.check(check.id)?.verdict, { state: "superseded" });
  assert.deepEqual(store.unannounced(MANAGER), [], "the manager, who handed the issue over, is told nothing");
  assert.equal(store.replaceAgent(holder, null, { ...next, ticket: "agent-3" }), null, "a holder that no longer holds is replaced once");
  assert.equal(store.agents(MANAGER).length, 2);
});

test("a handover whose insert fails writes nothing: the holder still holds, and its check still runs", () => {
  const { db, store, holder, handoffId, check, next } = handingOver();
  const allow = failWrites(db, "INSERT", "agents");
  assert.throws(() => store.replaceAgent(holder, handoffId, next), /forced failure/);
  assert.deepEqual(
    store.agents(MANAGER).map(({ id, ended }) => [id, ended]),
    [["a1", null]],
  );
  assert.equal(store.check(check.id)?.verdict.state, "running");
  assert.equal(store.roleFor("thr_x", "agent-2"), null, "no ticket minted");
  allow();
  assert.equal(store.replaceAgent(holder, handoffId, next), "a2");
});

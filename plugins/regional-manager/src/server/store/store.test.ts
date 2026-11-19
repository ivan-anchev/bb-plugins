import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema, type Handoff } from "../../model/handoff.ts";
import { issueViews } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { DEFAULT_AVATAR } from "../../model/profile.ts";
import { memoryStorage } from "../memory-storage.ts";
import type { NewAgent } from "./issue/agents-store.ts";
import { MIGRATIONS } from "./migrations.ts";
import { openStore } from "./store.ts";
import { EXECUTION, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "./test-store.ts";

test("a fresh database holds the design's tables and indexes, and nothing else", () => {
  const { db } = freshStore();
  const names = (type: string) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(type)
      .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.deepEqual(names("table"), ["agents", "checks", "coordinators", "decisions", "doorbells", "events", "fact_writes", "handoffs", "issue_relations", "issues", "memory_revisions", "pr_snapshots", "reminders", "roles"]);
  const facts = ["agents", "checks", "decisions", "handoffs", "issue_relations", "issues", "pr_snapshots"];
  assert.deepEqual(names("trigger"), [...facts.flatMap((table) => ["deleted", "inserted", "updated"].map((write) => `${table}_${write}`)), "roles_bound"]);
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

test("a regional manager started before profiles lists with no description and the plugin's own icon once the store is opened by this release", () => {
  const { db, storage } = memoryStorage();
  const profiles = MIGRATIONS.findIndex((statement) => statement.includes("ADD COLUMN description"));
  storage.migrate(db, MIGRATIONS.slice(0, profiles));
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('ticket-1', 'thr_a', ?, 1000)").run(JSON.stringify({ kind: "coordinator", coordinatorId: MANAGER }));
  db.prepare("INSERT INTO coordinators (id, ticket, project_id, verify, created_at) VALUES (?, 'ticket-1', 'prj_1', 1, 1000)").run(MANAGER);

  assert.deepEqual(openStore(storage).coordinators(), [{ id: MANAGER, threadId: "thr_a", projectId: "prj_1", verify: true, description: null, avatar: { kind: "icon", icon: "Workflow" }, createdAt: 1_000 }]);
});

test("an avatar this release can't draw, as an icon a later one stored, reads as the plugin's own icon, and the list still reads", () => {
  const { db, store } = freshStore();
  db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?").run(JSON.stringify({ kind: "icon", icon: "Rocket" }), MANAGER);

  assert.deepEqual(store.coordinator(MANAGER)?.avatar, DEFAULT_AVATAR);
  assert.equal(store.coordinators().length, 2);
});

test("a ticket binds once: a second bind, to the same or another thread, changes nothing", () => {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: MANAGER, ticket: "ticket-1", projectId: "prj_1", verify: true, description: null, avatar: DEFAULT_AVATAR, createdAt: 1_000 });
  assert.deepEqual(store.bindTicket("ticket-1", "thr_a"), { kind: "coordinator", coordinatorId: MANAGER });
  assert.equal(store.bindTicket("ticket-1", "thr_a"), null);
  assert.equal(store.bindTicket("ticket-1", "thr_b"), null);
  assert.deepEqual(store.roleOfThread("thr_a"), { kind: "coordinator", coordinatorId: MANAGER });
  assert.equal(store.roleOfThread("thr_b"), null);
});

test("a regional manager is listed once its thread is bound, and its unbound ticket configures only while unbound", () => {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: MANAGER, ticket: "ticket-1", projectId: "prj_1", verify: true, description: null, avatar: DEFAULT_AVATAR, createdAt: 1_000 });
  assert.deepEqual(store.coordinators(), []);
  assert.equal(store.coordinator(MANAGER), null);
  assert.equal(store.isCoordinator(MANAGER), true);
  assert.equal(store.roleFor("thr_a", "ticket-1")?.kind, "coordinator");

  store.bindTicket("ticket-1", "thr_a");
  assert.deepEqual(store.coordinators(), [{ id: MANAGER, threadId: "thr_a", projectId: "prj_1", verify: true, description: null, avatar: DEFAULT_AVATAR, createdAt: 1_000 }]);
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
    store.recordUnblocked(manager, issueViews(store.issues(manager).map((issue) => ({ issue, holder: null, ended: null, pr: null, openDecision: false, finalCheck: null }))), 3_000);
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
  assert.deepEqual([store.factWrites(MANAGER), store.factWrites(OTHER_MANAGER) > 0], [0, true]);
});

test("every write to what an issue's view is read from counts for its regional manager as it commits; a write rolled back, another manager's, and one the views never read count nothing", () => {
  const { db, store } = freshStore();
  const at = () => store.factWrites(MANAGER);
  const counted = <T>(what: string, write: () => T): T => {
    const before = at();
    const result = write();
    assert.ok(at() > before, `${what} counts`);
    return result;
  };
  const uncounted = (what: string, write: () => unknown): void => {
    const before = at();
    write();
    assert.equal(at(), before, `${what} counts nothing`);
  };
  const unheld = { requireUnheld: false, closes: new Map() };

  const i1 = counted("an issue filed", () => filedIssue(store, MANAGER, newIssue(), 2_000).id);
  const i2 = counted("an issue filed with a dependency", () => filedIssue(store, MANAGER, newIssue({ dependsOn: [i1] }), 2_000).id);
  counted("an issue edited", () => store.updateIssue(MANAGER, i1, { title: "Retries, with jitter" }, unheld));
  counted("a dependency removed", () => store.updateIssue(MANAGER, i2, { dependsOn: { add: [], remove: [i1] } }, unheld));
  const next: NewAgent = { coordinatorId: MANAGER, issueId: i1, ticket: "agent-1", placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution: EXECUTION, at: 2_000 };
  const agentId = counted("an agent started", () => store.insertAgent(next)) ?? assert.fail("no agent");
  counted("its thread bound", () => store.bindTicket("agent-1", "thr_agent-1"));
  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const done: Handoff = { id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId: i1, agentId, at: 3_000, turnSeq: 1, ...report, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } };
  counted("a done handoff", () => store.insertHandoff(done, { kind: "unread", reason: "unused" }));
  counted("a pull request read", () => store.savePrRead(MANAGER, "bb/retries", { issueId: i1, agentId }, null, null, 3_000));
  const decision = counted("a decision asked", () => store.insertDecision(MANAGER, { question: "Which queue?", options: [], issueId: i1 }, 3_000));
  counted("a decision answered", () => store.answerDecision(MANAGER, decision.id, "SQS", 3_100));
  counted("the agent ended", () => store.endAgent({ coordinatorId: MANAGER, id: agentId, issueId: i1 }, "stopped", null, false, 4_000));

  const allow = failWrites(db, "INSERT", "issue_relations");
  uncounted("a write rolled back", () => assert.throws(() => store.updateIssue(MANAGER, i2, { title: "Dead letters", dependsOn: { add: [i1], remove: [] } }, unheld), /forced failure/));
  allow();
  uncounted("another manager's issue", () => filedIssue(store, OTHER_MANAGER, newIssue(), 5_000));
  uncounted("a reminder", () => store.insertReminder(MANAGER, { note: "Look again", dueAt: 9_000, everyMs: null }));
  uncounted("a memory revision", () => store.memoryRevision(MANAGER, memoryFileSchema.parse("MEMORY.md"), "v1"));
});

/** a1 holding i1 with a done handoff whose check runs in `thr_verifier`, and a2 as a handover would insert it. */
function handingOver() {
  const { db, store } = freshStore();
  const { id: issueId } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const holder = { coordinatorId: MANAGER, id: startAgent(store, issueId, "agent-1"), issueId };
  const handoffId = handoffIdSchema.parse(randomUUID());
  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const done: Handoff = { id: handoffId, coordinatorId: MANAGER, issueId, agentId: holder.id, at: 3_000, turnSeq: 1, ...report, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } };
  const check = store.insertHandoff(done, { kind: "read", branch: null, checkout: { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 } }) ?? assert.fail("no check");
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

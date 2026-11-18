import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema } from "../../model/handoff.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { memoryStorage } from "../memory-storage.ts";
import { openStore } from "./store.ts";
import { freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "./test-store.ts";

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
  const filed = store.insertIssue(MANAGER, newIssue(), 2_000);
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
    const { id } = store.insertIssue(manager, newIssue(), 2_000);
    const agentId = startAgent(store, id, `agent-of-${manager}`, manager);
    store.insertHandoff(
      { id: handoffIdSchema.parse(randomUUID()), coordinatorId: manager, issueId: id, agentId, at: 3_000, turnSeq: 1, status: "blocked", summary: "Stuck", did: [], evidence: [], concerns: [], deviations: [], findings: [] },
      { kind: "unread", reason: "unused" },
    );
    store.insertDecision(manager, { question: "Which queue?", options: [], issueId: id }, 3_000);
    store.insertReminder(manager, { note: "Look again", dueAt: 9_000, everyMs: null });
    store.memoryRevision(manager, memoryFileSchema.parse("MEMORY.md"), "v1");
    store.savePrRead(manager, "bb/retries", { issueId: id, agentId }, null, null, 3_000);
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
  assert.deepEqual(store.coordinatorsToRing(), [OTHER_MANAGER]);

  assert.equal(store.issues(OTHER_MANAGER).length, 1);
  assert.equal(store.agents(OTHER_MANAGER).length, 1);
  assert.equal(store.decisions(OTHER_MANAGER).length, 1);
  assert.equal(store.roleOfThread("thr_manager_2")?.kind, "coordinator");
});

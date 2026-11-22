import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema, type Handoff } from "../../model/handoff.ts";
import { issueKeyOf } from "../../model/issue/key/issue-key.ts";
import { issueViews } from "../../model/issue/status.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { freeLook, seedOf, type Avatar } from "../../model/profile/avatar.ts";
import type { NewProfile } from "../../model/profile/profile.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import { memoryStorage } from "../memory-storage.ts";
import type { NewAgent } from "./issue/agents-store.ts";
import { MIGRATIONS } from "./migrations.ts";
import { openStore, type Store } from "./store.ts";
import { AVATAR, EXECUTION, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "./test-store.ts";

test("a fresh database holds the design's tables and indexes, and nothing else", () => {
  const { db } = freshStore();
  const names = (type: string) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(type)
      .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.deepEqual(names("table"), ["agents", "checks", "coordinators", "decisions", "doorbells", "events", "fact_writes", "handoffs", "issue_decisions", "issue_relations", "issues", "memory_revisions", "pr_snapshots", "reminders", "roles"]);
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
    "issue_decisions_of_issue",
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

/**
 * A database as the release before blobs left it: each regional manager named, in the order given,
 * created a second apart, its thread bound, pictured by one of bb's icons.
 */
function iconManagers(managers: readonly (readonly [CoordinatorId, string])[]) {
  const { db, storage } = memoryStorage();
  storage.migrate(db, [...MIGRATIONS]);
  managers.forEach(([id, name], n) => {
    db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES (?, ?, ?, ?)").run(`ticket-${n}`, `thr_${n}`, JSON.stringify({ kind: "coordinator", coordinatorId: id }), 1_000 + n);
    // why no avatar: the column's default is the icon every manager had before profiles, and the plugin's own icon after.
    db.prepare("INSERT INTO coordinators (id, ticket, project_id, name, created_at) VALUES (?, ?, 'prj_1', ?, ?)").run(id, `ticket-${n}`, name, 1_000 + n);
  });
  const stored = () => db.prepare("SELECT id, avatar FROM coordinators ORDER BY created_at").all().map((row) => z.object({ id: z.string(), avatar: z.string() }).parse(row));
  return { db, storage, stored };
}

const THIRD_MANAGER = coordinatorIdSchema.parse("0b9c8e5d-7a3f-4e2b-9c1d-5f6a7b8c9d0e");
const THREE = [[MANAGER, "Webhooks"], [OTHER_MANAGER, "Scout"], [THIRD_MANAGER, "Docs"]] as const;
const looksOf = (store: Store) => new Map(store.coordinators().map(({ id, avatar }) => [id, avatar]));
const lookKey = ({ shape, hue }: Avatar) => `${shape}/${hue}`;

test("regional managers pictured by an icon each get a blob look of their own as the store opens, taken from their ids and never their names", () => {
  const looks = looksOf(openStore(iconManagers(THREE).storage));

  assert.equal(looks.size, 3);
  assert.equal(new Set([...looks.values()].map(lookKey)).size, 3, "no two share a shape in a hue");
  const renamed = looksOf(openStore(iconManagers(THREE.map(([id]) => [id, "Another name"] as const)).storage));
  assert.deepEqual(renamed, looks, "the same ids under other names get the same looks");
});

test("of two icon managers whose ids seed the same look, the one created first keeps it and the later one gets the next free one, whatever order their rows were written in", () => {
  // why these ids: both seed bubble in pink (found once, written here so no test draws ids at random).
  const older = coordinatorIdSchema.parse("570ace8b-8f43-476b-a8a0-88aadbb4dfd6");
  const newer = coordinatorIdSchema.parse("1995df9c-c6da-42dc-ac05-5de892e7c72b");
  // why the newer row first: rows written in the reverse of their creation, so only created_at gives the order.
  const { db, storage } = iconManagers([[newer, "Newer"], [older, "Older"]]);
  db.prepare("UPDATE coordinators SET created_at = 2000 WHERE id = ?").run(newer);

  const looks = looksOf(openStore(storage));

  assert.deepEqual(looks.get(older), { kind: "blob", shape: "bubble", hue: "pink", expression: "happy" });
  assert.deepEqual(looks.get(newer), { kind: "blob", shape: "circle", hue: "cyan", expression: "curious" });
});

test("opening the store again changes no avatar: not the looks it gave, nor a look the user picked that another manager has", () => {
  const { db, storage, stored } = iconManagers(THREE);
  openStore(storage);
  const shared = looksOf(openStore(storage)).get(MANAGER);
  db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?").run(JSON.stringify(shared), OTHER_MANAGER);
  const before = stored();

  openStore(storage);

  assert.deepEqual(stored(), before);
});

test("a failed write gives no regional manager a look, and opening the store again gives each the look it would have had", () => {
  const { db, storage, stored } = iconManagers(THREE);
  const expected = looksOf(openStore(iconManagers(THREE).storage));
  const before = stored();
  const allow = failWrites(db, "UPDATE", "coordinators", `OLD.id = '${THIRD_MANAGER}'`);

  assert.throws(() => openStore(storage), /forced failure/);
  assert.deepEqual(stored(), before, "the two looks written before it were undone");

  allow();
  assert.deepEqual(looksOf(openStore(storage)), expected);
});

for (const [unreadable, stored] of [
  ["text that isn't JSON", "{not json"],
  ["a kind a later release stored", JSON.stringify({ kind: "image", url: "https://example.com/a.png" })],
] as const) {
  test(`managers created with an auto avatar next to one whose avatar is ${unreadable} never take the look it is drawn with`, () => {
    const { db, storage } = memoryStorage();
    const store = openStore(storage);
    const insert = (n: number, avatar: NewProfile["avatar"]) => store.insertCoordinator({ id: coordinatorIdSchema.parse(randomUUID()), ticket: `ticket-${n}`, name: `Manager ${n}`, description: null, avatar, createdAt: 1_000 + n });
    insert(0, AVATAR);
    db.prepare("UPDATE coordinators SET avatar = ?").run(stored);

    // why 251: with the unreadable one's, every look is then taken once, so one auto pick on its look would repeat it.
    for (let n = 1; n <= 251; n++) insert(n, { kind: "auto" });

    assert.equal(new Set(store.notStarted().map(({ avatar }) => lookKey(avatar))).size, 252);
  });
}

test("an icon manager whose id seeds the look an unreadable avatar is drawn with steps past it as the store opens", () => {
  const { db, storage } = iconManagers([[MANAGER, "Webhooks"]]);
  // why this id: it seeds bunny in rose, as MANAGER does (found once, written here so no test draws ids at random).
  const broken = coordinatorIdSchema.parse("4be35e2d-bb20-4bfb-abdd-e1d72643984b");
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('ticket-broken', NULL, ?, 900)").run(JSON.stringify({ kind: "coordinator", coordinatorId: broken }));
  db.prepare("INSERT INTO coordinators (id, ticket, project_id, name, avatar, created_at) VALUES (?, 'ticket-broken', '', 'Broken', '{not json', 900)").run(broken);

  const store = openStore(storage);

  assert.deepEqual(store.notStarted().find(({ id }) => id === broken)?.avatar, { kind: "blob", shape: "bunny", hue: "rose", expression: "neutral" }, "drawn with the look its id seeds");
  assert.deepEqual(store.coordinator(MANAGER)?.avatar, { kind: "blob", shape: "amoeba", hue: "rose", expression: "neutral" }, "the next free one after it");
});

test("an avatar this release can't draw, as a kind a later one stored or text that isn't JSON, reads as the look its id seeds, stays stored, and the list still reads", () => {
  const { db, storage } = freshStore();
  const later = JSON.stringify({ kind: "image", url: "https://example.com/a.png" });
  db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?").run(later, MANAGER);
  db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?").run("{not json", OTHER_MANAGER);

  const store = openStore(storage);

  const drawn = new Map(store.coordinators().map(({ id, avatar }) => [id, avatar]));
  assert.deepEqual(drawn, new Map([[MANAGER, freeLook(seedOf(MANAGER), [])], [OTHER_MANAGER, freeLook(seedOf(OTHER_MANAGER), [])]]));
  const stored = db.prepare("SELECT avatar FROM coordinators ORDER BY created_at, rowid").all().map((row) => z.object({ avatar: z.string() }).parse(row).avatar);
  assert.deepEqual(stored, [later, "{not json"]);
});

const SCOUT = { name: "Scout", description: null, avatar: AVATAR };

test("a ticket binds once: a second bind, to the same or another thread, changes nothing", () => {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: MANAGER, ticket: "ticket-1", ...SCOUT, createdAt: 1_000 });
  assert.deepEqual(store.bindTicket("ticket-1", "thr_a"), { kind: "coordinator", coordinatorId: MANAGER });
  assert.equal(store.bindTicket("ticket-1", "thr_a"), null);
  assert.equal(store.bindTicket("ticket-1", "thr_b"), null);
  assert.deepEqual(store.roleOfThread("thr_a"), { kind: "coordinator", coordinatorId: MANAGER });
  assert.equal(store.roleOfThread("thr_b"), null);
});

test("a regional manager is created not started, with its name and no project; it is listed as started once its thread is bound, and its unbound ticket configures only while unbound", () => {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: MANAGER, ticket: "ticket-1", ...SCOUT, createdAt: 1_000 });
  assert.deepEqual(store.coordinators(), []);
  assert.equal(store.coordinator(MANAGER), null);
  assert.deepEqual(store.notStarted(), [{ id: MANAGER, ...SCOUT }]);
  assert.deepEqual(store.startOf(MANAGER), { kind: "not-started", ticket: "ticket-1", name: "Scout" });
  assert.equal(store.roleFor("thr_a", "ticket-1")?.kind, "coordinator");

  store.startsOn(MANAGER, "prj_1", issueKeyOf("Webhooks"));
  store.bindTicket("ticket-1", "thr_a");
  assert.deepEqual(store.notStarted(), []);
  assert.deepEqual(store.startOf(MANAGER), { kind: "started", threadId: "thr_a" });
  assert.deepEqual(store.coordinators(), [{ id: MANAGER, threadId: "thr_a", projectId: "prj_1", description: null, avatar: AVATAR }]);
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
    store.recordUnblocked(manager, issueViews(store.issues(manager).map((issue) => ({ issue, holder: null, ended: null, pr: null, openDecision: false, finalCheck: null, verifierAsks: false }))), 3_000);
  }

  store.removeCoordinator(MANAGER);

  assert.equal(store.startOf(MANAGER), null);
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

/** a1 holding WEB-1 with a done handoff whose check runs in `thr_verifier`, and a2 as a handover would insert it. */
function handingOver() {
  const { db, store } = freshStore();
  const { id: issueId } = filedIssue(store, MANAGER, newIssue(), 2_000);
  const holder = { coordinatorId: MANAGER, id: startAgent(store, issueId, "agent-1"), issueId };
  const handoffId = handoffIdSchema.parse(randomUUID());
  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const done: Handoff = { id: handoffId, coordinatorId: MANAGER, issueId, agentId: holder.id, at: 3_000, turnSeq: 1, ...report, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } };
  const check = store.insertHandoff(done, { kind: "read", branch: null, checkout: { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 } }) ?? assert.fail("no check");
  store.insertCheckerTicket("verifier-1", { kind: "verifier", coordinatorId: MANAGER, issueId, checkId: check.id }, 3_000);
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

test("a 0.3.0 regional manager is a candidate of the upgrade until unheld: then it is not started, named, on a new unbound ticket, and its old thread holds no role", () => {
  const { db, storage } = memoryStorage();
  const held = MIGRATIONS.findIndex((statement) => statement.includes("ADD COLUMN name"));
  storage.migrate(db, MIGRATIONS.slice(0, held));
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('ticket-1', 'thr_a', ?, 1000)").run(JSON.stringify({ kind: "coordinator", coordinatorId: MANAGER }));
  db.prepare("INSERT INTO coordinators (id, ticket, project_id, verify, awaiting_goal, created_at) VALUES (?, 'ticket-1', 'prj_1', 1, 1, 1000)").run(MANAGER);
  const store = openStore(storage);
  assert.deepEqual(store.upgradeCandidates(), [{ id: MANAGER, ticket: "ticket-1", threadId: "thr_a", flagged: true }]);

  store.unhold(MANAGER, "ticket-1", "Webhooks", "ticket-2", 2_000);
  store.unhold(MANAGER, "ticket-1", "Again", "ticket-3", 3_000);

  assert.deepEqual([store.upgradeCandidates(), store.coordinators()], [[], []]);
  // why that avatar: a 0.3.0 manager had the plugin's icon, which the store gives the first free look from its id as it opens.
  assert.deepEqual(store.notStarted(), [{ id: MANAGER, name: "Webhooks", description: null, avatar: freeLook(seedOf(MANAGER), []) }]);
  assert.deepEqual(store.startOf(MANAGER), { kind: "not-started", ticket: "ticket-2", name: "Webhooks" });
  assert.equal(store.roleOfThread("thr_a"), null);
  assert.equal(store.roleFor("thr_a", "ticket-1"), null);
});

test("both lists are newest first: the regional managers not started yet, and the started ones", () => {
  const store = openStore(memoryStorage().storage);
  for (const [id, n, at] of [[MANAGER, 1, 1_000], [OTHER_MANAGER, 2, 2_000]] as const) store.insertCoordinator({ id, ticket: `ticket-${n}`, ...SCOUT, name: `Scout ${n}`, createdAt: at });
  assert.deepEqual(store.notStarted().map(({ name }) => name), ["Scout 2", "Scout 1"]);

  for (const [id, n] of [[MANAGER, 1], [OTHER_MANAGER, 2]] as const) {
    store.startsOn(id, "prj_1", issueKeyOf("Webhooks"));
    store.bindTicket(`ticket-${n}`, `thr_${n}`);
  }
  assert.deepEqual(store.coordinators().map(({ threadId }) => threadId), ["thr_2", "thr_1"]);
});

test("a regional manager's stored name changes before its start only: once started, its thread's title is its name", () => {
  const store = openStore(memoryStorage().storage);
  store.insertCoordinator({ id: MANAGER, ticket: "ticket-1", ...SCOUT, createdAt: 1_000 });
  store.rename(MANAGER, "Scout 2");
  assert.deepEqual(store.startOf(MANAGER), { kind: "not-started", ticket: "ticket-1", name: "Scout 2" });

  store.setProfile(MANAGER, { description: "Finds work", avatar: AVATAR });
  assert.deepEqual(store.notStarted(), [{ id: MANAGER, name: "Scout 2", description: "Finds work", avatar: AVATAR }]);
});

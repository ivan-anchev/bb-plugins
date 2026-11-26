import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { handoffIdSchema, type Handoff } from "../../model/agent/handoff.ts";
import { issueKeyOf, issueKeySchema } from "../../model/issue/key/issue-key.ts";
import { checkIdSchema } from "../../model/verdict/check.ts";
import { issueViews } from "../../model/issue/status.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { SHAPES, type Avatar } from "../../model/profile/avatar.ts";
import type { NewProfile } from "../../model/profile/profile.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import { memoryStorage } from "../memory-storage.ts";
import type { NewAgent } from "./issue/agents-store.ts";
import { MIGRATIONS } from "./migrations.ts";
import { openStore, type Store } from "./store.ts";
import { asBeforeKeys, AVATAR, EXECUTION, failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, passWithShouldFix, startAgent } from "./test-store.ts";

test("a fresh database holds the design's tables and indexes, and nothing else", () => {
  const { db } = freshStore();
  const names = (type: string) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(type)
      .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.deepEqual(names("table"), ["agents", "checks", "comments", "coordinators", "decisions", "doorbells", "events", "fact_writes", "handoffs", "issue_decisions", "issue_log", "issue_relations", "issue_writes", "issues", "memory_revisions", "pr_snapshots", "reminders", "roles"]);
  const facts = ["agents", "checks", "decisions", "handoffs", "issue_relations", "issues", "pr_snapshots"];
  const feeds = ["agents_issue_id", "checks_issue_id", "comments_issue_id", "handoffs_issue_id", "issue_decisions_issue_id", "issue_log_issue_id", "issue_relations_depends_on", "issue_relations_issue_id", "issues_id"];
  const writes = (tables: string[]) => tables.flatMap((table) => ["deleted", "inserted", "updated"].map((write) => `${table}_${write}`));
  assert.deepEqual(
    names("trigger"),
    [...writes(facts), "roles_bound", ...writes(feeds), "decisions_issue_inserted", "decisions_issue_updated", "events_issue_inserted", "roles_issue_bound"].sort(),
  );
  assert.deepEqual(names("index"), [
    "agents_holding",
    "checks_of_issue",
    "checks_open",
    "checks_unsettled",
    "comments_by_submission",
    "comments_of_issue",
    "decisions_of_coordinator",
    "events_of_issue",
    "events_own_tree",
    "events_unread",
    "handoffs_of_agent",
    "handoffs_of_issue",
    "issue_decisions_of_issue",
    "issue_log_of_issue",
    "issue_log_statuses",
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
  // why these ids: both seed hexagon in green (found once, written here so no test draws ids at random).
  const older = coordinatorIdSchema.parse("f40765bd-fede-4f06-adad-6b89824f90a5");
  const newer = coordinatorIdSchema.parse("11cf8b9a-a1a7-4fb2-814b-31718b7e27e1");
  // why the newer row first: rows written in the reverse of their creation, so only created_at gives the order.
  const { db, storage } = iconManagers([[newer, "Newer"], [older, "Older"]]);
  db.prepare("UPDATE coordinators SET created_at = 2000 WHERE id = ?").run(newer);

  const looks = looksOf(openStore(storage));

  assert.deepEqual(looks.get(older), { kind: "blob", shape: "hexagon", hue: "green", expression: "neutral" });
  assert.deepEqual(looks.get(newer), { kind: "blob", shape: "star", hue: "green", expression: "neutral" });
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

/**
 * Every hue a release before the user's palette offered, and the one of the user's 11 its blob is
 * drawn in from then on: the closest, or the same one where the name stayed.
 */
const NEW_HUE_OF_OLD: readonly (readonly [string, Avatar["hue"]])[] = [
  ["violet", "purple"], ["blue", "blue"], ["emerald", "green"], ["sky", "teal"], ["amber", "amber"], ["rose", "red"],
  ["lime", "green"], ["teal", "teal"], ["orange", "orange"], ["indigo", "blue"], ["pink", "pink"], ["cyan", "teal"],
];

/** A database as the release before the user's palette left it: one manager a blob in each hue it offered, in its own shape, with a curious face, created in that order. */
function oldHueManagers() {
  const managers = NEW_HUE_OF_OLD.map(([old, hue], n) => ({ id: coordinatorIdSchema.parse(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`), old, hue, shape: SHAPES[n] }));
  const { db, storage, stored } = iconManagers(managers.map(({ id, old }) => [id, old]));
  for (const { id, old, shape } of managers) db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?").run(JSON.stringify({ kind: "blob", shape, hue: old, expression: "curious" }), id);
  const expected = new Map(managers.map(({ id, hue, shape }): [CoordinatorId, Avatar] => [id, { kind: "blob", shape, hue, expression: "neutral" }]));
  return { db, storage, stored, managers, expected };
}

test("a manager stored in a hue and a face of the earlier releases keeps its shape as the store opens, in its hue or the closest of the user's colours, with the neutral face, written back; a second opening changes nothing", () => {
  const { storage, stored, expected } = oldHueManagers();

  const looks = looksOf(openStore(storage));

  assert.deepEqual(looks, expected);
  assert.deepEqual(stored().map(({ avatar }) => JSON.parse(avatar)), [...expected.values()], "stored as drawn");
  const after = stored();
  openStore(storage);
  assert.deepEqual(stored(), after);
});

test("of two managers whose earlier hues become one colour in one shape, the one created first keeps the look and the later one gets the next free one from there", () => {
  const { db, storage } = iconManagers([[MANAGER, "Older"], [OTHER_MANAGER, "Newer"]]);
  const set = db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?");
  set.run(JSON.stringify({ kind: "blob", shape: "circle", hue: "lime", expression: "happy" }), OTHER_MANAGER);
  set.run(JSON.stringify({ kind: "blob", shape: "circle", hue: "emerald", expression: "happy" }), MANAGER);

  const looks = looksOf(openStore(storage));

  assert.deepEqual(looks.get(MANAGER), { kind: "blob", shape: "circle", hue: "green", expression: "neutral" });
  assert.deepEqual(looks.get(OTHER_MANAGER), { kind: "blob", shape: "pebble", hue: "green", expression: "neutral" });
});

test("a failed write recolours no manager of the earlier palette, and opening the store again recolours each as it would have", () => {
  const { db, storage, stored, managers, expected } = oldHueManagers();
  const before = stored();
  const last = managers.at(-1);
  assert.ok(last);
  const allow = failWrites(db, "UPDATE", "coordinators", `OLD.id = '${last.id}'`);

  assert.throws(() => openStore(storage), /forced failure/);
  assert.deepEqual(stored(), before, "the looks written before it were undone");

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
    // why MANAGER for the unreadable one: the look it is drawn with is then fixed (bunny in brown). The others store blobs, whose looks don't depend on their ids.
    const insert = (n: number, avatar: NewProfile["avatar"], id = coordinatorIdSchema.parse(randomUUID())) => store.insertCoordinator({ id, ticket: `ticket-${n}`, name: `Manager ${n}`, description: null, avatar, createdAt: 1_000 + n });
    insert(0, AVATAR, MANAGER);
    db.prepare("UPDATE coordinators SET avatar = ?").run(stored);

    // why 230: with the unreadable one's, every look is then taken once, so one auto pick on its look would repeat it.
    for (let n = 1; n <= 230; n++) insert(n, { kind: "auto" });

    assert.equal(new Set(store.notStarted().map(({ avatar }) => lookKey(avatar))).size, 231);
  });
}

test("an icon manager whose id seeds the look an unreadable avatar is drawn with steps past it as the store opens", () => {
  const { db, storage } = iconManagers([[MANAGER, "Webhooks"]]);
  // why this id: it seeds bunny in brown, as MANAGER does (found once, written here so no test draws ids at random).
  const broken = coordinatorIdSchema.parse("6818a660-f004-4b61-8547-8d2f28f3c744");
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('ticket-broken', NULL, ?, 900)").run(JSON.stringify({ kind: "coordinator", coordinatorId: broken }));
  db.prepare("INSERT INTO coordinators (id, ticket, project_id, name, avatar, created_at) VALUES (?, 'ticket-broken', '', 'Broken', '{not json', 900)").run(broken);

  const store = openStore(storage);

  assert.deepEqual(store.notStarted().find(({ id }) => id === broken)?.avatar, { kind: "blob", shape: "bunny", hue: "brown", expression: "neutral" }, "drawn with the look its id seeds");
  assert.deepEqual(store.coordinator(MANAGER)?.avatar, { kind: "blob", shape: "amoeba", hue: "brown", expression: "neutral" }, "the next free one after it");
});

test("an avatar this release can't draw, as a kind a later one stored or text that isn't JSON, reads as the look its id seeds, stays stored, and the list still reads", () => {
  const { db, storage } = freshStore();
  const later = JSON.stringify({ kind: "image", url: "https://example.com/a.png" });
  db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?").run(later, MANAGER);
  db.prepare("UPDATE coordinators SET avatar = ? WHERE id = ?").run("{not json", OTHER_MANAGER);

  const store = openStore(storage);

  const drawn = new Map(store.coordinators().map(({ id, avatar }) => [id, avatar]));
  // why these: the looks MANAGER's and OTHER_MANAGER's ids seed.
  assert.deepEqual(drawn, new Map([[MANAGER, { kind: "blob", shape: "bunny", hue: "brown", expression: "neutral" }], [OTHER_MANAGER, { kind: "blob", shape: "heart", hue: "blue", expression: "neutral" }]]));
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

const WEB_1 = issueIdSchema.parse("WEB-1");

test("removing a regional manager removes everything it owns, and nothing of another's; a removal that fails part way removes nothing, and the same removal then succeeds", () => {
  const { db, store } = freshStore();
  for (const manager of [MANAGER, OTHER_MANAGER]) {
    const { id } = filedIssue(store, manager, newIssue(), 2_000);
    const agentId = startAgent(store, id, `agent-of-${manager}`, manager);
    store.insertHandoff(
      { id: handoffIdSchema.parse(randomUUID()), coordinatorId: manager, issueId: id, agentId, at: 3_000, turnSeq: 1, status: "blocked", summary: "Stuck", did: [], evidence: [], concerns: [], deviations: [], findings: [] },
      { kind: "unread", reason: "unused" },
      null,
    );
    store.insertDecision(manager, { question: "Which queue?", options: [], issueId: id }, 3_000);
    store.insertReminder(manager, { note: "Look again", dueAt: 9_000, everyMs: null });
    store.memoryRevision(manager, memoryFileSchema.parse("MEMORY.md"), "v1");
    store.savePrRead(manager, "bb/retries", { issueId: id, agentId }, null, null, 3_000);
    filedIssue(store, manager, { ...newIssue(), dependsOn: [id] }, 3_000);
    store.recordUnblocked(manager, issueViews(store.issues(manager).map((issue) => ({ issue, holder: null, ended: null, accepted: null, pr: null, openDecisions: [], finalCheck: null, verifierAsks: false }))), 3_000);
    store.updateIssue(manager, id, { title: "Retries, with jitter" }, { requireUnheld: false, closes: new Map(), at: 3_000 });
  }

  // why the issues: they are deleted after their log, so the failure comes once the log is gone.
  const restore = failWrites(db, "DELETE", "issues");
  assert.throws(() => store.removeCoordinator(MANAGER), /forced failure/);
  assert.equal(store.issues(MANAGER).length, 2, "its issues stay");
  assert.deepEqual(store.logOf(MANAGER, WEB_1), [{ at: 3_000, event: { kind: "edited", fields: ["title"] } }], "and their log with them");
  assert.equal(store.agents(MANAGER).length, 1);
  assert.equal(store.decisions(MANAGER).length, 1);
  assert.equal(store.roleOfThread("thr_manager_1")?.kind, "coordinator");

  restore();
  store.removeCoordinator(MANAGER);

  assert.equal(store.startOf(MANAGER), null);
  assert.deepEqual(store.issues(MANAGER), []);
  assert.deepEqual(store.agents(MANAGER), []);
  assert.deepEqual(store.decisions(MANAGER), []);
  assert.deepEqual(store.reminders(MANAGER), []);
  assert.equal(store.roleOfThread("thr_manager_1"), null);
  assert.equal(store.roleOfThread(`thr_agent-of-${MANAGER}`), null);
  assert.equal(store.prOfBranch(MANAGER, "bb/retries"), null);
  assert.deepEqual(store.logOf(MANAGER, WEB_1), []);
  assert.deepEqual(store.coordinatorsToRing(), [OTHER_MANAGER]);

  assert.equal(store.issues(OTHER_MANAGER).length, 2);
  assert.equal(store.agents(OTHER_MANAGER).length, 1);
  assert.equal(store.decisions(OTHER_MANAGER).length, 1);
  assert.deepEqual(store.logOf(OTHER_MANAGER, WEB_1), [{ at: 3_000, event: { kind: "edited", fields: ["title"] } }]);
  assert.equal(store.roleOfThread("thr_manager_2")?.kind, "coordinator");
  assert.deepEqual([store.factWrites(MANAGER), store.factWrites(OTHER_MANAGER) > 0], [0, true]);
  assert.deepEqual([store.issueWrites(MANAGER).size, store.issueWrites(OTHER_MANAGER).size], [0, 2]);
});

test("removing a regional manager whose issue passed with a follow-up removes the origin, its follow-up and the check naming it, and nothing of another's", () => {
  const { db, store } = freshStore();
  for (const manager of [MANAGER, OTHER_MANAGER]) {
    const { id } = filedIssue(store, manager, newIssue(), 2_000);
    passWithShouldFix(store, id, startAgent(store, id, `agent-of-${manager}`, manager), 1, 3_000, manager);
  }
  assert.deepEqual(store.issues(MANAGER).map(({ id, dependsOn }) => [id, dependsOn]), [[WEB_1, []], ["WEB-2", [WEB_1]]], "the pass filed a follow-up");

  store.removeCoordinator(MANAGER);

  assert.equal(store.startOf(MANAGER), null);
  assert.deepEqual(store.issues(MANAGER), []);
  assert.deepEqual(db.prepare("SELECT follow_up_id AS followUpId FROM checks WHERE coordinator_id = ?").all(MANAGER), []);
  assert.deepEqual(db.prepare("SELECT issue_id AS issueId FROM issue_relations WHERE coordinator_id = ?").all(MANAGER), []);
  assert.deepEqual(store.issues(OTHER_MANAGER).map(({ id }) => id), [WEB_1, "WEB-2"]);
  assert.deepEqual(db.prepare("SELECT follow_up_id AS followUpId FROM checks WHERE coordinator_id = ?").all(OTHER_MANAGER), [{ followUpId: "WEB-2" }]);
});

test("keying a regional manager whose issues are i1, i2 renames the follow-up each check names, and the follow-up's origin is found under its new id", () => {
  const { db, store } = freshStore();
  const origin = filedIssue(store, MANAGER, newIssue(), 2_000);
  passWithShouldFix(store, origin.id, startAgent(store, origin.id, "agent-1"), 1, 3_000);
  asBeforeKeys(db);
  assert.deepEqual(db.prepare("SELECT issue_id AS issueId, follow_up_id AS followUpId FROM checks WHERE coordinator_id = ?").all(MANAGER), [{ issueId: "i1", followUpId: "i2" }]);

  assert.equal(store.keyIssues(MANAGER, issueKeySchema.parse("BBP")), true);

  assert.deepEqual(db.prepare("SELECT issue_id AS issueId, follow_up_id AS followUpId FROM checks WHERE coordinator_id = ?").all(MANAGER), [{ issueId: "BBP-1", followUpId: "BBP-2" }]);
  const followUp = issueIdSchema.parse("BBP-2");
  passWithShouldFix(store, followUp, startAgent(store, followUp, "agent-2"), 2, 4_000);
  assert.equal(store.issue(MANAGER, issueIdSchema.parse("BBP-3"))?.title, "Follow-ups from BBP-1: Add retries", "its follow-up is titled after the first origin");
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
  const unheld = { requireUnheld: false, closes: new Map(), at: 3_000 };

  const i1 = counted("an issue filed", () => filedIssue(store, MANAGER, newIssue(), 2_000).id);
  const i2 = counted("an issue filed with a dependency", () => filedIssue(store, MANAGER, newIssue({ dependsOn: [i1] }), 2_000).id);
  counted("an issue edited", () => store.updateIssue(MANAGER, i1, { title: "Retries, with jitter" }, unheld));
  counted("a dependency removed", () => store.updateIssue(MANAGER, i2, { dependsOn: { add: [], remove: [i1] } }, unheld));
  const next: NewAgent = { coordinatorId: MANAGER, issueId: i1, ticket: "agent-1", placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution: EXECUTION, at: 2_000 };
  const agentId = counted("an agent started", () => store.insertAgent(next)) ?? assert.fail("no agent");
  counted("its thread bound", () => store.bindTicket("agent-1", "thr_agent-1"));
  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const done: Handoff = { id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId: i1, agentId, at: 3_000, turnSeq: 1, ...report, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } };
  counted("a done handoff", () => store.insertHandoff(done, { kind: "unread", reason: "unused" }, null));
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
  const check = store.insertHandoff(done, { kind: "read", branch: null, checkout: { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 } }, null) ?? assert.fail("no check");
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
  assert.deepEqual(store.notStarted(), [{ id: MANAGER, name: "Webhooks", description: null, avatar: { kind: "blob", shape: "bunny", hue: "brown", expression: "neutral" } }]);
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

test("every write to what an issue's feed reads counts for that issue as it commits, and only for it; a dependency counts for both its issues; a write rolled back counts nothing", () => {
  const { db, store } = freshStore();
  store.startsOn(MANAGER, "prj_1", issueKeySchema.parse("BBP"));
  const issues = Array.from({ length: 19 }, (_, i) => filedIssue(store, MANAGER, newIssue({ title: `Issue ${i + 1}` }), 2_000).id);
  const [bbp7, bbp19] = [issues[6] ?? assert.fail(), issues[18] ?? assert.fail()];
  assert.deepEqual([bbp7, bbp19], ["BBP-7", "BBP-19"]);
  /** The issues whose count `write` moved. */
  const moved = (write: () => unknown): string[] => {
    const before = store.issueWrites(MANAGER);
    write();
    return [...store.issueWrites(MANAGER)].filter(([id, writes]) => before.get(id) !== writes).map(([id]) => id);
  };
  const agentId = startAgent(store, bbp19, "agent-1");
  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const done = (at: number): Handoff => ({ id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId: bbp19, agentId, at, turnSeq: at, ...report, status: "done", delivery: { kind: "commit", headSha: "a".repeat(40), prUrl: null } });
  const unheld = { requireUnheld: false, closes: new Map(), at: 3_000 };

  assert.deepEqual(moved(() => store.insertHandoff(done(3_000), { kind: "unread", reason: "unused" }, null)), [bbp19], "a handoff");
  assert.deepEqual(moved(() => store.updateIssue(MANAGER, bbp19, { dependsOn: { add: [bbp7], remove: [] } }, unheld)).sort(), [bbp19, bbp7].sort(), "a dependency");
  assert.deepEqual(moved(() => store.insertDecision(MANAGER, { question: "Which queue?", options: [], issueId: bbp7 }, 3_100)), [bbp7], "a question about it");
  assert.deepEqual(moved(() => store.updateIssue(MANAGER, bbp19, { decision: { text: "SQS", at: 3_200 } }, unheld)), [bbp19], "a decision recorded on it");
  assert.deepEqual(moved(() => store.insertEvent(MANAGER, { kind: "unblocked", issueId: bbp19, by: bbp7, closedAs: "done" }, 3_300)), [bbp19], "an inbox event naming it");
  assert.deepEqual(moved(() => store.insertEvent(MANAGER, { kind: "verification-toggled", verify: false }, 3_400)), [], "an event naming no issue");
  const facts = store.factWrites(MANAGER);
  const seen = [{ issue: store.issue(MANAGER, bbp7) ?? assert.fail("no BBP-7"), status: "todo" as const }];
  assert.deepEqual(moved(() => store.observeStatuses(MANAGER, seen, 3_450)), [bbp7], "a status observed in its log");
  assert.equal(store.factWrites(MANAGER), facts, "a status observed is no fact a view is read from, so it never overtakes the read it was observed from");
  assert.deepEqual(moved(() => store.insertReminder(MANAGER, { note: "Look again", dueAt: 9_000, everyMs: null })), [], "a reminder");
  assert.deepEqual(moved(() => filedIssue(store, OTHER_MANAGER, newIssue(), 3_500)), [], "another manager's issue");

  const allow = failWrites(db, "INSERT", "checks");
  assert.deepEqual(moved(() => assert.throws(() => store.insertHandoff(done(4_000), { kind: "unread", reason: "unused" }, null), /forced failure/)), [], "a handoff whose check failed to write");
  allow();
  assert.deepEqual(moved(() => store.insertHandoff(done(4_000), { kind: "unread", reason: "unused" }, null)), [bbp19], "the same handoff, retried");
});

test("a verdict and a review stored before they kept their time take their check's announcement's time as the plugin upgrades, else the check's own", () => {
  const { db, storage } = memoryStorage();
  const times = MIGRATIONS.findIndex((statement) => statement.includes("json_set(verdict, '$.at'"));
  storage.migrate(db, MIGRATIONS.slice(0, times));
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('ticket-1', 'thr_a', ?, 1000)").run(JSON.stringify({ kind: "coordinator", coordinatorId: MANAGER }));
  db.prepare("INSERT INTO coordinators (id, ticket, project_id, verify, created_at, issue_key) VALUES (?, 'ticket-1', 'prj_1', 1, 1000, 'WEB')").run(MANAGER);
  db.prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, done_criteria, rest, created_at) VALUES (?, 'WEB-1', 'build', 'Retries', 'Lost deliveries.', '[\"npm test passes\"]', 'todo', 1000)").run(MANAGER);
  const returned = {
    state: "returned",
    verifierThreadId: "thr_verifier",
    headSha: "a".repeat(40),
    checkout: { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 },
    criteria: [{ criterion: "npm test passes", result: "fail", evidence: "# fail 1" }],
    findings: [],
    triage: [{ result: "confirmed", reason: "Seen." }],
    model: { providerId: "claude-code", model: "sonnet" },
    sameModel: false,
    settlement: { kind: "sent-back", round: 1, ci: { kind: "none" } },
  };
  const reported = { state: "reported", reviewerThreadId: "thr_reviewer", findings: [{ file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap." }], model: { providerId: "codex", model: "gpt-5.4" } };
  const subject = { kind: "final", defaultBranch: "main", merged: [] };
  const check = (id: string, verdict: object, review: object, at: number) =>
    db.prepare("INSERT INTO checks (id, coordinator_id, issue_id, subject, criteria, verdict, review, at) VALUES (?, ?, 'WEB-1', ?, '[\"npm test passes\"]', ?, ?, ?)").run(id, MANAGER, JSON.stringify(subject), JSON.stringify(verdict), JSON.stringify(review), at);
  const announced = "4f1e2d3c-1b2a-4c9d-8e7f-6a5b4c3d2e1f";
  const unannounced = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
  check(announced, returned, reported, 2_000);
  check(unannounced, { state: "could-not-run", verifierThreadId: null, reason: "bb did not start a verifier" }, { state: "missed", reviewerThreadId: null, reason: "bb did not start a reviewer" }, 2_500);
  const event = (event: object, at: number) => db.prepare("INSERT INTO events (coordinator_id, event, at) VALUES (?, ?, ?)").run(MANAGER, JSON.stringify(event), at);
  event({ kind: "sent-back", issueId: "WEB-1", agentId: "a1", checkId: announced, round: 1 }, 7_000);
  event({ kind: "checked", issueId: "WEB-1", checkId: announced }, 9_000);

  const store = openStore(storage);
  const [first, second] = [store.check(checkIdSchema.parse(announced)), store.check(checkIdSchema.parse(unannounced))];
  assert.deepEqual([first?.verdict.state === "returned" && first.verdict.at, first?.review.state === "reported" && first.review.at], [7_000, 7_000], "the sent-back event's time, the earliest naming its check");
  assert.deepEqual([second?.verdict.state === "could-not-run" && second.verdict.at, second?.review.state === "missed" && second.review.at], [2_500, 2_500], "none announced it: the check's own time");
});

test("a reported review stored before findings had an origin, a title or earlier answers reads with every finding new, titled by its claim's first sentence clipped to 80 characters, and no earlier answers, its verdict's triage joined to them", () => {
  const { db, storage } = memoryStorage();
  storage.migrate(db, [...MIGRATIONS]);
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('ticket-1', 'thr_a', ?, 1000)").run(JSON.stringify({ kind: "coordinator", coordinatorId: MANAGER }));
  db.prepare("INSERT INTO coordinators (id, ticket, project_id, verify, created_at, issue_key) VALUES (?, 'ticket-1', 'prj_1', 1, 1000, 'WEB')").run(MANAGER);
  db.prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, done_criteria, rest, created_at) VALUES (?, 'WEB-1', 'build', 'Retries', 'Lost deliveries.', '[\"npm test passes\"]', 'todo', 1000)").run(MANAGER);
  // As a release before origins and titles stored them: no origin or title on a finding, no earlier on the review.
  const long = "The retry loop doubles its delay on every failure with no upper bound at all, so a dead endpoint waits for hours";
  const findings = [
    { file: "src/retry.ts", line: 4, severity: "must-fix", claim: "No cap. The delay doubles forever." },
    { file: "src/retry.css", line: null, severity: "nit", claim: "The rollback never\nclears the cache. A retry sees stale state." },
    { file: "src/retry.ts", line: 9, severity: "should-fix", claim: `${long}.\nSee line 9.` },
  ];
  const review = { state: "reported", at: 3_000, reviewerThreadId: "thr_reviewer", findings, model: { providerId: "codex", model: "gpt-5.4" } };
  const verdict = {
    state: "returned",
    at: 4_000,
    verifierThreadId: "thr_verifier",
    headSha: "a".repeat(40),
    checkout: { headSha: "a".repeat(40), changedFiles: [], changedFileCount: 0 },
    criteria: [{ criterion: "npm test passes", result: "pass", evidence: "# pass 1" }],
    findings: [],
    triage: [
      { result: "anchored", anchor: "brief", reason: "Seen." },
      { result: "rejected", reason: "Matches." },
      { result: "confirmed", reason: "Seen." },
    ],
    mustFixFails: true,
    model: { providerId: "claude-code", model: "sonnet" },
    sameModel: false,
    settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
  };
  // why a branch: every check's subject has one once the plugin's migrations ran (migrations.ts).
  const subject = { kind: "handoff", agentId: "a1", handoffId: randomUUID(), headSha: "a".repeat(40), prUrl: null, branch: null };
  const id = randomUUID();
  db.prepare("INSERT INTO checks (id, coordinator_id, issue_id, subject, criteria, verdict, review, at) VALUES (?, ?, 'WEB-1', ?, '[\"npm test passes\"]', ?, ?, 2000)").run(
    id,
    MANAGER,
    JSON.stringify(subject),
    JSON.stringify(verdict),
    JSON.stringify(review),
  );

  const check = openStore(storage).check(checkIdSchema.parse(id)) ?? assert.fail("no check");
  // why the second whole: a claim wrapped mid-sentence keeps its first sentence, on one line.
  const titles = ["No cap.", "The rollback never clears the cache.", `${long.slice(0, 79)}…`];
  assert.equal(titles[2]?.length, 80);
  assert.deepEqual(check.review.state === "reported" && [check.review.findings, check.review.earlier], [findings.map((finding, i) => ({ ...finding, title: titles[i], origin: "new" })), []]);
  assert.deepEqual(check.verdict.state === "returned" && check.verdict.triage.map(({ title, origin, result }) => [title, origin, result]), [
    ["No cap.", "new", "anchored"],
    [titles[1], "new", "rejected"],
    [titles[2], "new", "confirmed"],
  ]);
});

test("a check stored before checks kept their work's branch gets its agent's branch as last recorded when the store opens", () => {
  const { db, storage } = memoryStorage();
  storage.migrate(db, MIGRATIONS.slice(0, -1));
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('ticket-1', 'thr_a', ?, 1000)").run(JSON.stringify({ kind: "coordinator", coordinatorId: MANAGER }));
  db.prepare("INSERT INTO coordinators (id, ticket, project_id, verify, created_at, issue_key) VALUES (?, 'ticket-1', 'prj_1', 1, 1000, 'WEB')").run(MANAGER);
  db.prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, done_criteria, rest, created_at) VALUES (?, 'WEB-1', 'build', 'Retries', 'Lost deliveries.', '[\"npm test passes\"]', 'todo', 1000)").run(MANAGER);
  db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES ('agent-1', 'thr_b', '{}', 1100)").run();
  db.prepare("INSERT INTO agents (coordinator_id, id, issue_id, ticket, placement, base, execution, branch, started_at) VALUES (?, 'a1', 'WEB-1', 'agent-1', '{}', '{}', '{}', 'bb/thr_b', 1100)").run(MANAGER);
  const handoffId = randomUUID();
  db.prepare("INSERT INTO handoffs (id, coordinator_id, issue_id, agent_id, report, turn_seq, at) VALUES (?, ?, 'WEB-1', 'a1', '{}', 1, 2000)").run(handoffId, MANAGER);
  // As a release before branches were kept: no branch on the subject.
  const subject = { kind: "handoff", agentId: "a1", handoffId, headSha: "a".repeat(40), prUrl: null };
  const id = randomUUID();
  db.prepare("INSERT INTO checks (id, coordinator_id, issue_id, handoff_id, subject, criteria, verdict, review, at) VALUES (?, ?, 'WEB-1', ?, ?, '[\"npm test passes\"]', ?, '{\"state\":\"queued\"}', 2000)").run(
    id,
    MANAGER,
    handoffId,
    JSON.stringify(subject),
    JSON.stringify({ state: "queued", checkout: null }),
  );

  const check = openStore(storage).check(checkIdSchema.parse(id)) ?? assert.fail("no check");
  assert.deepEqual(check.subject, { ...subject, branch: "bb/thr_b" });
});

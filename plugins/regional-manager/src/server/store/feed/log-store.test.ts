import assert from "node:assert/strict";
import { test } from "node:test";
import type { Issue } from "../../../model/issue/issue.ts";
import type { IssueStatus } from "../../../model/issue/status.ts";
import { memoryStorage } from "../../memory-storage.ts";
import { MIGRATIONS } from "../migrations.ts";
import { openStore } from "../store.ts";
import { failWrites, filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER } from "../test-store.ts";

const seen = (...views: [Issue, IssueStatus][]) => views.map(([issue, status]) => ({ issue, status }));

test("an issue filed before the log has one log-began row where it began, as the plugin upgrades; one filed since has none", () => {
  const { db, storage } = memoryStorage();
  const log = MIGRATIONS.findIndex((statement) => statement.startsWith("CREATE TABLE issue_log"));
  storage.migrate(db, MIGRATIONS.slice(0, log));
  for (const [n, id] of [[1, MANAGER], [2, OTHER_MANAGER]] as const) {
    db.prepare("INSERT INTO roles (ticket, thread_id, role, created_at) VALUES (?, ?, ?, 1000)").run(`ticket-${n}`, `thr_${n}`, JSON.stringify({ kind: "coordinator", coordinatorId: id }));
    db.prepare("INSERT INTO coordinators (id, ticket, project_id, verify, created_at, issue_key) VALUES (?, ?, 'prj_1', 1, 1000, 'WEB')").run(id, `ticket-${n}`);
  }
  const fileEarlier = (id: string, number: number) =>
    db.prepare("INSERT INTO issues (coordinator_id, id, kind, title, description, done_criteria, rest, created_at) VALUES (?, ?, 'build', 'Retries', 'Lost deliveries.', '[]', 'todo', 1000)").run(id, `WEB-${number}`);
  fileEarlier(MANAGER, 1);
  fileEarlier(MANAGER, 2);
  fileEarlier(OTHER_MANAGER, 1);
  const before = Date.now();

  const store = openStore(storage);
  const after = Date.now();
  const [one, two, elsewhere] = [...store.issues(MANAGER), ...store.issues(OTHER_MANAGER)].map((issue) => store.logOf(issue.coordinatorId, issue.id));
  for (const began of [one, two, elsewhere]) {
    assert.deepEqual(began?.map(({ event }) => event), [{ kind: "log-began" }]);
    const at = began?.[0]?.at ?? assert.fail("no row");
    assert.ok(at >= before - 1 && at <= after + 1, `began as the plugin upgraded, at ${at}`);
  }
  const since = filedIssue(store, MANAGER, newIssue(), 2_000);
  assert.deepEqual(store.logOf(MANAGER, since.id), []);
});

test("observing statuses logs each issue's status that isn't the last one logged, and the same views again log nothing", () => {
  const { store } = freshStore();
  const one = filedIssue(store, MANAGER, newIssue(), 2_000);
  const two = filedIssue(store, MANAGER, newIssue(), 2_000);

  assert.equal(store.observeStatuses(MANAGER, seen([one, "todo"], [two, "backlog"]), 3_000), 2);
  assert.equal(store.observeStatuses(MANAGER, seen([one, "todo"], [two, "backlog"]), 3_100), 0, "the same views: idempotent");
  assert.equal(store.observeStatuses(MANAGER, seen([one, "in-progress"], [two, "backlog"]), 3_200), 1);
  assert.equal(store.observeStatuses(MANAGER, seen([one, "todo"], [two, "backlog"]), 3_300), 1, "back to an earlier status is a move too");
  assert.deepEqual(store.logOf(MANAGER, one.id), [
    { at: 3_000, event: { kind: "status", status: "todo" } },
    { at: 3_200, event: { kind: "status", status: "in-progress" } },
    { at: 3_300, event: { kind: "status", status: "todo" } },
  ]);
  assert.deepEqual(store.logOf(MANAGER, two.id), [{ at: 3_000, event: { kind: "status", status: "backlog" } }]);
  assert.deepEqual(store.logOf(OTHER_MANAGER, one.id), [], "another manager's issue of the same id logged nothing");
});

test("a status that fails to be logged takes the pass's other statuses back with it, and the same views then log them all", () => {
  const { db, store } = freshStore();
  const one = filedIssue(store, MANAGER, newIssue(), 2_000);
  const two = filedIssue(store, MANAGER, newIssue(), 2_000);
  const allow = failWrites(db, "INSERT", "issue_log", "json_extract(NEW.event, '$.status') = 'backlog'");
  assert.throws(() => store.observeStatuses(MANAGER, seen([one, "todo"], [two, "backlog"]), 3_000), /forced failure/);
  assert.deepEqual([store.logOf(MANAGER, one.id), store.logOf(MANAGER, two.id)], [[], []]);

  allow();
  assert.equal(store.observeStatuses(MANAGER, seen([one, "todo"], [two, "backlog"]), 3_100), 2);
  assert.deepEqual([store.logOf(MANAGER, one.id).length, store.logOf(MANAGER, two.id).length], [1, 1]);
});

test("a row this version can't read is left out of the log, and a status it doesn't know is logged after with the status seen", () => {
  const { db, store } = freshStore();
  const one = filedIssue(store, MANAGER, newIssue(), 2_000);
  store.observeStatuses(MANAGER, seen([one, "todo"]), 3_000);
  // why raw rows: they stand in for what a newer version of the plugin logged, a kind and a status this one doesn't know, and a row JSON.parse can't decode, which SQLite stores as JSON5.
  const insert = db.prepare("INSERT INTO issue_log (coordinator_id, issue_id, at, event) VALUES (?, ?, ?, ?)");
  insert.run(MANAGER, one.id, 3_100, JSON.stringify({ kind: "commented", text: "Looks right" }));
  insert.run(MANAGER, one.id, 3_200, '{kind:"edited",fields:["title"],}');
  insert.run(MANAGER, one.id, 3_300, JSON.stringify({ kind: "status", status: "parked" }));

  assert.deepEqual(store.logOf(MANAGER, one.id), [{ at: 3_000, event: { kind: "status", status: "todo" } }], "the rows it can read, in order");
  assert.equal(store.observeStatuses(MANAGER, seen([one, "todo"]), 3_400), 1, "the watch goes on, and logs the status it sees after one it doesn't know");
  assert.equal(store.observeStatuses(MANAGER, seen([one, "todo"]), 3_500), 0, "once");
  assert.deepEqual(store.logOf(MANAGER, one.id), [
    { at: 3_000, event: { kind: "status", status: "todo" } },
    { at: 3_400, event: { kind: "status", status: "todo" } },
  ]);
});

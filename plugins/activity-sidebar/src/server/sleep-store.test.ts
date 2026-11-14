import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { openSleepStore } from "./sleep-store.ts";

// A real SQLite, migrated as bb's helper would: each statement once.
function store() {
  const db = new Database(":memory:");
  const s = openSleepStore({ database: () => db, migrate: (handle, statements) => statements.forEach((statement) => handle.exec(statement)) });
  // why: the read promises no order; the list keys it by thread.
  return { set: s.set, all: () => s.all().sort((a, b) => a.threadId.localeCompare(b.threadId)) };
}

test("a sleep set reads back; setting it again replaces it; null deletes it", () => {
  const s = store();
  assert.deepEqual(s.all(), []);
  s.set("thr_a", 1_000);
  s.set("thr_b", 2_000);
  assert.deepEqual(s.all(), [
    { threadId: "thr_a", until: 1_000 },
    { threadId: "thr_b", until: 2_000 },
  ]);
  s.set("thr_a", 3_000);
  assert.deepEqual(s.all(), [
    { threadId: "thr_a", until: 3_000 },
    { threadId: "thr_b", until: 2_000 },
  ]);
  s.set("thr_a", null);
  assert.deepEqual(s.all(), [{ threadId: "thr_b", until: 2_000 }]);
});

test("writes are idempotent: the same write twice leaves one row, a delete of nothing is fine", () => {
  const s = store();
  s.set("thr_a", 1_000);
  s.set("thr_a", 1_000);
  s.set("thr_gone", null);
  assert.deepEqual(s.all(), [{ threadId: "thr_a", until: 1_000 }]);
});

test("the handle is asked for on every use, so a reopened one is picked up", () => {
  let db = new Database(":memory:");
  const migrate = (handle: Database.Database, statements: string[]) => statements.forEach((statement) => handle.exec(statement));
  const s = openSleepStore({ database: () => db, migrate });
  s.set("thr_a", 1_000);
  const reopened = new Database(":memory:");
  migrate(reopened, ["CREATE TABLE sleeps (thread_id TEXT PRIMARY KEY, until INTEGER NOT NULL)"]);
  db = reopened;
  assert.deepEqual(s.all(), []);
});

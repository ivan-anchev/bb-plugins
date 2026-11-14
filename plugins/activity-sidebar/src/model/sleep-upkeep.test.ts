import assert from "node:assert/strict";
import { test } from "node:test";
import type { SleepRecord } from "../contract.ts";
import { thread } from "./fixtures.ts";
import { NOTHING_TRIED, upkeepWrites } from "./sleep-upkeep.ts";

const H = 3_600_000;
const T = 20 * H;
const asks = thread("a", { indicator: "waiting-for-input" });
const answered = thread("a");

function sleeps(...records: SleepRecord[]): ReadonlyMap<string, SleepRecord> {
  return new Map(records.map((r) => [r.threadId, r]));
}

test("a sleeper asking for you is woken once; its rollback after a refusal sends nothing again", () => {
  const first = upkeepWrites({ threads: [asks], sleeps: sleeps({ threadId: "a", until: T }), now: T - H, activeThreadId: null }, NOTHING_TRIED);
  assert.deepEqual([first.wake, first.forget], [["a"], []]);

  // The wake was refused: the record rolls back to `until` T and the thread still asks.
  const rolledBack = upkeepWrites({ threads: [asks], sleeps: sleeps({ threadId: "a", until: T }), now: T - H, activeThreadId: null }, first.tried);
  assert.deepEqual([rolledBack.wake, rolledBack.forget], [[], []]);
});

test("a refused early wake doesn't stop the forget: past its time, opening it forgets the sleep once", () => {
  const record = { threadId: "a", until: T };
  const woken = upkeepWrites({ threads: [asks], sleeps: sleeps(record), now: T - H, activeThreadId: null }, NOTHING_TRIED);
  // Refused: the record is still `until` T. Answered, it waits until T; then it is opened.
  const opened = upkeepWrites({ threads: [answered], sleeps: sleeps(record), now: T + 60_000, activeThreadId: "a" }, woken.tried);
  assert.deepEqual([opened.wake, opened.forget], [[], ["a"]]);

  const again = upkeepWrites({ threads: [answered], sleeps: sleeps(record), now: T + 120_000, activeThreadId: "a" }, opened.tried);
  assert.deepEqual([again.wake, again.forget], [[], []]);
});

test("only the open thread is forgotten, and only once its time has come", () => {
  const records = sleeps({ threadId: "a", until: T }, { threadId: "b", until: T - H });
  const threads = [answered, thread("b")];
  assert.deepEqual(upkeepWrites({ threads, sleeps: records, now: T - 1, activeThreadId: "a" }, NOTHING_TRIED).forget, []);
  assert.deepEqual(upkeepWrites({ threads, sleeps: records, now: T - 1, activeThreadId: null }, NOTHING_TRIED).forget, []);
  assert.deepEqual(upkeepWrites({ threads, sleeps: records, now: T - 1, activeThreadId: "b" }, NOTHING_TRIED).forget, ["b"]);
});

test("a new sleep of the same thread is a new record: it is woken and forgotten afresh", () => {
  const first = upkeepWrites({ threads: [asks], sleeps: sleeps({ threadId: "a", until: T }), now: T - H, activeThreadId: null }, NOTHING_TRIED);
  const slept = upkeepWrites({ threads: [asks], sleeps: sleeps({ threadId: "a", until: T + H }), now: T - H, activeThreadId: null }, first.tried);
  assert.deepEqual(slept.wake, ["a"]);
});

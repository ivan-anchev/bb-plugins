import assert from "node:assert/strict";
import { test } from "node:test";
import { drain } from "./drain.ts";
import { parseTarget, type Target } from "./routes.ts";
import { memoryFailureLog } from "./test-support.ts";
import { TEST_BODY } from "./wake-body.ts";

test("drain removes the entries it delivers and keeps the rest with their new reason", async () => {
  const { failures } = memoryFailureLog();
  const ops = target("ops");
  const dev = target("dev");
  failures.record(ops, { ...TEST_BODY, thread: "thr_1" }, "http 500");
  failures.record(dev, { ...TEST_BODY, thread: "thr_2" }, "timeout");
  failures.record(ops, { ...TEST_BODY, thread: "thr_3" }, "network");

  const tried: string[] = [];
  const counts = await drain(
    failures,
    async (to, body) => {
      tried.push(`${to}:${body.thread}`);
      return to === ops ? { ok: true, status: 200 } : { ok: false, reason: "missing-secret" };
    },
    new AbortController().signal,
  );

  assert.deepEqual(tried, ["OPS:thr_1", "DEV:thr_2", "OPS:thr_3"]);
  assert.deepEqual(counts, { delivered: 2, kept: 1 });
  assert.deepEqual(
    failures.list().map((entry) => ({ target: entry.target, thread: entry.body.thread, reason: entry.reason })),
    [{ target: "DEV", thread: "thr_2", reason: "missing-secret" }],
  );
});

test("draining an empty log does nothing", async () => {
  const { failures } = memoryFailureLog();
  const counts = await drain(failures, async () => assert.fail("nothing to deliver"), new AbortController().signal);
  assert.deepEqual(counts, { delivered: 0, kept: 0 });
});

test("a delivery cancelled mid-drain stops it there and leaves the rest of the log as it was", async () => {
  const { failures } = memoryFailureLog();
  const ops = target("ops");
  failures.record(ops, { ...TEST_BODY, thread: "thr_1" }, "http 500");
  failures.record(ops, { ...TEST_BODY, thread: "thr_2" }, "http 500");
  failures.record(ops, { ...TEST_BODY, thread: "thr_3" }, "timeout");

  const caller = new AbortController();
  const tried: string[] = [];
  const counts = await drain(
    failures,
    async (_to, body) => {
      tried.push(body.thread);
      if (body.thread === "thr_1") return { ok: true, status: 200 };
      caller.abort();
      return { ok: false, reason: "cancelled" };
    },
    caller.signal,
  );

  assert.deepEqual(tried, ["thr_1", "thr_2"]);
  assert.deepEqual(counts, { delivered: 1, kept: 0 });
  assert.deepEqual(
    failures.list().map((entry) => ({ thread: entry.body.thread, reason: entry.reason })),
    [
      { thread: "thr_2", reason: "http 500" },
      { thread: "thr_3", reason: "timeout" },
    ],
  );
});

test("a drain whose signal has already aborted tries nothing and changes nothing", async () => {
  const { failures } = memoryFailureLog();
  failures.record(target("ops"), { ...TEST_BODY, thread: "thr_1" }, "http 500");
  failures.record(target("ops"), { ...TEST_BODY, thread: "thr_2" }, "timeout");
  const caller = new AbortController();
  caller.abort();

  const counts = await drain(failures, async () => ({ ok: false, reason: "missing-secret" }), caller.signal);

  assert.deepEqual(counts, { delivered: 0, kept: 0 });
  assert.deepEqual(failures.list().map((entry) => entry.reason), ["http 500", "timeout"]);
});

function target(name: string): Target {
  const parsed = parseTarget(name);
  assert.ok(parsed);
  return parsed;
}

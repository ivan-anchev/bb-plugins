import assert from "node:assert/strict";
import { test } from "node:test";
import { BoatApiError } from "./client.ts";
import { createStartGate, StartLimitError } from "./start-gate.ts";

const rateLimited = (retryAfterMs: number) =>
  new BoatApiError(429, "rate_limited", "Start limit reached for this minute.", retryAfterMs, false);
const signal = () => AbortSignal.timeout(10_000);

test("a short start window is waited out once, and the retry is marked", async () => {
  const gate = createStartGate();
  const calls: boolean[] = [];

  const result = await gate.start(async (retry) => {
    calls.push(retry);
    if (!retry) throw rateLimited(20);
    return "started";
  }, signal());

  assert.equal(result, "started");
  assert.deepEqual(calls, [false, true]);
});

test("a long start window fails now, and so do later starts, without asking boat", async () => {
  const gate = createStartGate();
  let calls = 0;
  const start = async () => {
    calls += 1;
    throw rateLimited(10 * 60_000);
  };

  await assert.rejects(gate.start(start, signal()), StartLimitError);
  await assert.rejects(gate.start(start, signal()), StartLimitError);
  assert.equal(calls, 1);
});

test("refusals that waiting does not clear surface as boat sent them", async () => {
  const gate = createStartGate();
  const refusal = new BoatApiError(429, "limit_reached", "Too many sandboxes at once.", null, false);

  await assert.rejects(gate.start(async () => Promise.reject(refusal), signal()), refusal);
});

test("a 429 on the retry fails the start, and later starts respect its window", async () => {
  const gate = createStartGate();
  let calls = 0;
  const start = async (retry: boolean) => {
    calls += 1;
    throw rateLimited(retry ? 10 * 60_000 : 20);
  };

  const failure = await gate.start(start, signal()).catch((error: unknown) => error);
  assert.ok(failure instanceof StartLimitError);
  assert.ok(failure.nextStartAt > Date.now() + 9 * 60_000);
  await assert.rejects(gate.start(start, signal()), StartLimitError);
  assert.equal(calls, 2);
});

test("an uncounted start runs past a window, and a 429 for it holds back later starts", async () => {
  const gate = createStartGate();
  const counted: string[] = [];
  await assert.rejects(gate.start(async () => Promise.reject(rateLimited(10 * 60_000)), signal()), StartLimitError);

  assert.equal(await gate.startUncounted(async () => "kept", signal()), "kept");
  await assert.rejects(gate.startUncounted(async () => Promise.reject(rateLimited(20 * 60_000)), signal()), StartLimitError);
  const failure = await gate.start(async () => void counted.push("start"), signal()).catch((error: unknown) => error);

  assert.ok(failure instanceof StartLimitError);
  assert.ok(failure.nextStartAt > Date.now() + 19 * 60_000);
  assert.deepEqual(counted, []);
});

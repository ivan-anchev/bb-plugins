import assert from "node:assert/strict";
import { test } from "node:test";
import type { Quote } from "../contract.ts";
import { createDailyQuote, type DailyQuoteDeps } from "./daily-quote.ts";

const MONDAY_NOON = new Date(2026, 10, 16, 12).getTime();
const quoteNumber = (n: number): Quote => ({ character: "Michael Scott", quote: `Quote ${n}`, avatar: "https://example.com/m.png" });

function harness(overrides: Partial<DailyQuoteDeps> = {}) {
  const store = new Map<string, unknown>();
  const calls = { fetches: 0, changed: 0, warnings: 0 };
  let now = MONDAY_NOON;
  const deps: DailyQuoteDeps = {
    kv: { get: async <T,>(k: string) => store.get(k) as T | undefined, set: async (k, v) => void store.set(k, v) },
    fetchQuote: async () => quoteNumber(++calls.fetches),
    onChanged: () => void calls.changed++,
    warn: () => void calls.warnings++,
    now: () => now,
    ...overrides,
  };
  return { daily: createDailyQuote(deps), calls, setNow: (ms: number) => (now = ms) };
}

test("every read on the same day shows the same quote, fetched once", async () => {
  const { daily, calls, setNow } = harness();
  assert.deepEqual(await daily.read(), quoteNumber(1));
  setNow(new Date(2026, 10, 16, 23, 59).getTime());
  assert.deepEqual(await daily.read(), quoteNumber(1));
  assert.equal(calls.fetches, 1);
});

test("the first read after midnight brings a new quote and tells open homepages", async () => {
  const { daily, calls, setNow } = harness();
  await daily.read();
  setNow(new Date(2026, 10, 17, 0, 1).getTime());
  assert.deepEqual(await daily.read(), quoteNumber(2));
  assert.equal(calls.changed, 2);
});

test("reads and the midnight job running at once share one fetch", async () => {
  const { daily, calls } = harness();
  await Promise.all([daily.read(), daily.read(), daily.ensureToday()]);
  assert.equal(calls.fetches, 1);
});

test("a failed fetch keeps yesterday's quote and tries again on the next read", async () => {
  let failing = false;
  let fetches = 0;
  const { daily, calls, setNow } = harness({
    fetchQuote: async () => (failing ? Promise.reject(new Error("429")) : quoteNumber(++fetches)),
  });
  await daily.read();
  setNow(new Date(2026, 10, 17, 9).getTime());
  failing = true;
  assert.deepEqual(await daily.read(), quoteNumber(1));
  assert.equal(calls.warnings, 1);
  failing = false;
  assert.deepEqual(await daily.read(), quoteNumber(2));
});

test("with no quote ever fetched, a failure shows nothing", async () => {
  const { daily } = harness({ fetchQuote: () => Promise.reject(new Error("offline")) });
  assert.equal(await daily.read(), null);
});

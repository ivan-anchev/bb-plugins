import assert from "node:assert/strict";
import { test } from "node:test";
import { SLEEPS_TAG } from "../contract.ts";
import { createRpcHandlers } from "./rpc-handlers.ts";
import type { SleepStore } from "./sleep-store.ts";

const CONTEXT = { experimental_caller: { kind: "client" }, experimental_signal: new AbortController().signal } as const;

// The store stands in as a map; each event records a write or an invalidation, in order.
function harness() {
  const rows = new Map<string, number>();
  const events: string[] = [];
  const store: SleepStore = {
    all: () => [...rows].map(([threadId, until]) => ({ threadId, until })),
    set: (threadId, until) => {
      events.push(`set ${threadId} ${until}`);
      if (until === null) rows.delete(threadId);
      else rows.set(threadId, until);
    },
  };
  const handlers = createRpcHandlers({ rpc: { experimental_invalidate: (tags) => void events.push(`invalidate ${tags.join(",")}`) }, store });
  return { handlers, events };
}

test("every write invalidates the sleeps read after storing it: a sleep, a wake and a forget", async () => {
  const { handlers, events } = harness();
  await handlers.setSleep({ threadId: "thr_a", until: 5_000 }, CONTEXT);
  await handlers.setSleep({ threadId: "thr_a", until: 1_000 }, CONTEXT);
  await handlers.setSleep({ threadId: "thr_a", until: null }, CONTEXT);
  const invalidate = `invalidate ${SLEEPS_TAG}`;
  assert.deepEqual(events, ["set thr_a 5000", invalidate, "set thr_a 1000", invalidate, "set thr_a null", invalidate]);
});

test("the read returns every record and invalidates nothing", async () => {
  const { handlers, events } = harness();
  await handlers.setSleep({ threadId: "thr_a", until: 5_000 }, CONTEXT);
  events.length = 0;
  assert.deepEqual(await handlers.sleeps({}, CONTEXT), { sleeps: [{ threadId: "thr_a", until: 5_000 }] });
  assert.deepEqual(events, []);
});

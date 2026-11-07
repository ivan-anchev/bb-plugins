import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHideReviewThreads } from "./hide-review-threads.ts";

type Row = { id: string; visibility: "visible" | "hidden"; archived: boolean; originPluginId: string | null };
type ListArgs = { originPluginId?: string; archived?: boolean; includeHidden?: boolean; limit?: number; offset?: number };
type Service = { start(signal: AbortSignal): Promise<void> };

const SHOWN_REVIEW: Row = { id: "thr_review", visibility: "visible", archived: false, originPluginId: "pr-reviews" };
const ROWS: Row[] = [
  SHOWN_REVIEW,
  { id: "thr_already_hidden", visibility: "hidden", archived: false, originPluginId: "pr-reviews" },
  { id: "thr_archived_review", visibility: "visible", archived: true, originPluginId: "pr-reviews" },
  { id: "thr_users_own", visibility: "visible", archived: false, originPluginId: null },
  { id: "thr_other_plugins", visibility: "visible", archived: false, originPluginId: "side-chat" },
];

// A test that would otherwise hang when `start` ignores an abort fails instead.
const STOPS_IN_TIME = { timeout: 1_000 };

// bb's threads as `list` filters and pages them; the first `failingUpdates` updates reject, and
// `holdReads` keeps every read waiting until its release is called.
function harness(rows: Row[], failingUpdates = 0) {
  const threads = new Map(rows.map((row) => [row.id, { ...row }]));
  const kv = new Map<string, unknown>();
  const updates: string[] = [];
  let reads = 0;
  let readsReleased: Promise<void> = Promise.resolve();
  let failuresLeft = failingUpdates;
  const services = new Map<string, Service>();
  const read = async <T>(value: () => T): Promise<T> => {
    reads += 1;
    await readsReleased;
    return value();
  };
  const bb = {
    pluginId: "pr-reviews",
    background: { service: (name: string, service: Service) => void services.set(name, service) },
    storage: {
      kv: {
        get: (key: string) => read(() => kv.get(key)),
        set: async (key: string, value: true) => void kv.set(key, value),
      },
    },
    sdk: {
      threads: {
        list: ({ originPluginId, archived, includeHidden, limit = Infinity, offset = 0 }: ListArgs) =>
          read(() =>
            [...threads.values()]
              .filter((row) => row.originPluginId === originPluginId && row.archived === archived && (includeHidden === true || row.visibility === "visible"))
              .slice(offset, offset + limit),
          ),
        update: async ({ threadId, visibility }: { threadId: string; visibility: "hidden" }) => {
          if (failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error("bb could not update the thread");
          }
          updates.push(threadId);
          threads.set(threadId, { ...threads.get(threadId)!, visibility });
        },
      },
    },
  };
  registerHideReviewThreads(bb);
  return {
    service: services.get("hide-review-threads")!,
    updates,
    reads: () => reads,
    jobDone: () => kv.get("started-review-threads-hidden") === true,
    holdReads: () => {
      let release!: () => void;
      readsReleased = new Promise((resolve) => (release = resolve));
      return release;
    },
    show: (id: string) => threads.set(id, { ...threads.get(id)!, visibility: "visible" }),
    visibilityOf: (id: string) => threads.get(id)?.visibility,
  };
}

// Every fake call settles on the microtask queue, so a macrotask turn lets the hiding go as far as it can.
const drained = () => new Promise((resolve) => setImmediate(resolve));

// One plugin load: bb starts the service, the hiding runs to its end, then bb stops the service.
async function load(service: Service): Promise<void> {
  const stop = new AbortController();
  await Promise.all([service.start(stop.signal), drained().then(() => stop.abort())]);
}

test("hides the shown threads PR Reviews started, and nothing else", STOPS_IN_TIME, async () => {
  const { service, updates, visibilityOf } = harness(ROWS);
  await load(service);
  assert.deepEqual(updates, ["thr_review"]);
  assert.equal(visibilityOf("thr_users_own"), "visible", "a thread the user started is left alone");
  assert.equal(visibilityOf("thr_other_plugins"), "visible", "another plugin's thread is left alone");
  assert.equal(visibilityOf("thr_archived_review"), "visible", "an archived thread is not in the sidebar");
});

test("the service keeps running after the hiding, and stops when bb aborts it", STOPS_IN_TIME, async () => {
  const { service, jobDone } = harness(ROWS);
  const stop = new AbortController();
  let stopped = false;
  const running = service.start(stop.signal).then(() => (stopped = true));
  await drained();
  assert.equal(jobDone(), true);
  assert.equal(stopped, false, "start resolves only on abort");
  stop.abort();
  await running;
});

test("an abort before start reads and hides nothing, and start resolves", STOPS_IN_TIME, async () => {
  const { service, updates, reads, jobDone } = harness(ROWS);
  const stop = new AbortController();
  stop.abort();
  await service.start(stop.signal);
  assert.equal(reads(), 0);
  assert.deepEqual(updates, []);
  assert.equal(jobDone(), false);
});

test("an abort during a read stops the hiding there, and the next load finishes it", STOPS_IN_TIME, async () => {
  const { service, updates, jobDone, holdReads, visibilityOf } = harness(ROWS);
  const releaseReads = holdReads();
  const stop = new AbortController();
  const running = service.start(stop.signal);
  await drained();
  stop.abort();
  await running;
  releaseReads();
  await drained();
  assert.deepEqual(updates, [], "nothing is hidden after the abort");
  assert.equal(jobDone(), false, "the job is not marked done");

  await load(service);
  assert.equal(visibilityOf("thr_review"), "hidden");
  assert.equal(jobDone(), true);
});

test("runs once: a review thread the user shows again afterwards stays shown", STOPS_IN_TIME, async () => {
  const { service, updates, show, visibilityOf } = harness(ROWS);
  await load(service);
  show("thr_review");
  await load(service);
  assert.deepEqual(updates, ["thr_review"]);
  assert.equal(visibilityOf("thr_review"), "visible");
});

test("reads every page before hiding, so no shown thread is skipped", STOPS_IN_TIME, async () => {
  const reviews = Array.from({ length: 450 }, (_, index): Row => ({ ...SHOWN_REVIEW, id: `thr_review_${index}` }));
  const { service, updates } = harness(reviews);
  await load(service);
  assert.equal(new Set(updates).size, 450);
});

test("a failed update leaves the job undone, and the restart hides only what is still shown", STOPS_IN_TIME, async () => {
  const { service, updates, visibilityOf } = harness([SHOWN_REVIEW, { ...SHOWN_REVIEW, id: "thr_second_review" }], 1);
  await assert.rejects(load(service), /could not update/);
  await load(service);
  assert.equal(visibilityOf("thr_review"), "hidden");
  assert.equal(visibilityOf("thr_second_review"), "hidden");
  assert.deepEqual([...updates].sort(), ["thr_review", "thr_second_review"], "no thread is hidden twice");
});

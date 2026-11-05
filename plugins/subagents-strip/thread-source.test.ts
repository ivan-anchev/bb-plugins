// The live thread source, through its public surface, against a fake browser
// SDK that serves the trimmed real captures (see normalise.test.ts and child-threads.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { ChildThread, DelegationRow, EventRow, ThreadChange, ThreadSdk, TimelineRow } from "./bb.ts";
import type { Delegate, DelegateStatus } from "./delegate.ts";
import { createThreadSource, type ThreadSource } from "./thread-source.ts";

const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);
type ChildRead = { child: ChildThread; rows: TimelineRow[] };
const { counter }: { counter: { running: ChildRead; settled: ChildRead } } = JSON.parse(
  readFileSync(new URL("./fixtures/child-threads.json", import.meta.url), "utf8"),
);
const CHILD = counter.running.child.id;

// The window is visible; the source only reads `visibilityState` and listens for changes.
Object.assign(globalThis, { document: Object.assign(new EventTarget(), { visibilityState: "visible" }) });

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
afterEach(() => mock.timers.reset());

test("a page that fails mid-drain is retried from the committed cursor, so no task event is skipped", async () => {
  const completed = fixture.events.find((e): e is TaskCompleted => e.type === "item/backgroundTask/completed" && e.seq === 1498);
  assert.ok(completed);
  const delegate = completed.data.item.parentToolCallId;
  assert.ok(delegate);
  const bb = fakeBb({ events: fixture.events.filter((e) => e.seq <= 1354) });
  const source = createThreadSource(bb.sdk, "thr_r1_cursor", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.equal(statusOf(source, delegate), "running");

  // A full first page of progress ends on the completion; the second page fails once.
  bb.events.push(...progressBefore(completed, EVENT_PAGE - 1), completed);
  bb.failEventsAfter = completed.seq;
  bb.change("events-appended");
  await settle();
  assert.equal(statusOf(source, delegate), "running", "the failed pull changes nothing");

  bb.change("events-appended");
  await settle();
  assert.equal(statusOf(source, delegate), "completed");
  stop();
});

test("a failed first load commits nothing: the next pull reads the rows", async () => {
  const bb = fakeBb({ events: fixture.events });
  bb.failTimeline = true;
  const source = createThreadSource(bb.sdk, "thr_r1_reload", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.equal(source.snapshot.status, "failed");

  bb.change("events-appended");
  await settle();
  assert.equal(delegatesOf(source).length, 8);
  stop();
});

test("a failed reload after a history rewrite is owed: the next pull rereads the rewritten rows", async () => {
  const bb = fakeBb({ events: fixture.events });
  const source = createThreadSource(bb.sdk, "thr_r1_rewrite", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.equal(delegatesOf(source).length, 8);

  bb.rows = fixture.rows.slice(0, 1);
  bb.failTimeline = true;
  bb.change("history-rewritten");
  await settle();
  assert.equal(delegatesOf(source).length, 8, "the failed reload keeps the last good snapshot");

  bb.change("events-appended");
  await settle();
  assert.equal(delegatesOf(source).length, 1);
  stop();
});

test("a row-only delegate that settles inside the throttle window settles after one trailing read", async () => {
  const running = fixture.rows.map((row) => withDelegationStatus(row, "pending"));
  const bb = fakeBb({ rows: running, events: [] });
  const source = createThreadSource(bb.sdk, "thr_r2_trailing", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.ok(delegatesOf(source).every((d) => d.state.status === "running"));

  mock.timers.tick(500);
  bb.rows = fixture.rows;
  bb.change("events-appended");
  await settle();
  assert.equal(bb.timelineReads, 1, "the throttle skips the read");

  mock.timers.tick(1_500);
  await settle();
  assert.equal(bb.timelineReads, 2);
  assert.ok(delegatesOf(source).every((d) => d.state.status === "completed"));
  stop();
});

test("stopping the source cancels its trailing read", async () => {
  const bb = fakeBb({ rows: fixture.rows.map((row) => withDelegationStatus(row, "pending")), events: [] });
  const stop = createThreadSource(bb.sdk, "thr_r2_stop", () => {}).subscribe(() => {});
  await settle();
  mock.timers.tick(500);
  bb.change("events-appended");
  await settle();
  stop();

  mock.timers.tick(2_000);
  await settle();
  assert.equal(bb.timelineReads, 1);
});

test("a pull still awaiting events when the last subscriber leaves ends there: no timer, no further read", async () => {
  const bb = fakeBb({ rows: fixture.rows.map((row) => withDelegationStatus(row, "pending")), events: [] });
  let idle = 0;
  const stop = createThreadSource(bb.sdk, "thr_r2_inflight", () => idle++).subscribe(() => {});
  await settle();
  mock.timers.tick(500);
  const release = bb.holdEvents();
  bb.change("events-appended");
  await settle();
  stop();
  const readsAtStop = bb.reads;

  release(); // the events land after stop(), inside the throttle window
  await settle();
  mock.timers.tick(2_000);
  await settle();
  assert.equal(bb.reads, readsAtStop, "no SDK read after stop");
  assert.equal(bb.timelineReads, 1);
  assert.equal(idle, 1);
});

// ---------------------------------------------------------------- child threads

test("a child not seen before rereads the parent rows; a settled child is read once", async () => {
  const bb = fakeBb({ events: fixture.events });
  const stop = createThreadSource(bb.sdk, "thr_c_unseen", () => {}).subscribe(() => {});
  await settle();
  assert.equal(bb.readsOf("thr_c_unseen"), 1);

  bb.serveChild(counter.settled);
  bb.change("events-appended");
  await settle();
  assert.equal(bb.readsOf("thr_c_unseen"), 2, "its spawning turn may be newer than the rows held");
  assert.equal(bb.readsOf(CHILD), 1);
  // why: without nested rows bb collapses a settled turn (`children: null`), leaving the child no steps.
  assert.equal(bb.lastQuery.get(CHILD)?.includeNestedRows, "true");

  mock.timers.tick(5_000);
  bb.change("events-appended");
  bb.change("events-appended", CHILD);
  await settle();
  assert.equal(bb.readsOf("thr_c_unseen"), 2);
  assert.equal(bb.readsOf(CHILD), 1, "its updatedAt has not moved");
  stop();
});

test("a running child rereads only its own rows, on the throttle", async () => {
  const bb = fakeBb({ events: fixture.events });
  bb.serveChild(counter.running);
  const source = createThreadSource(bb.sdk, "thr_c_running", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.equal(statusOf(source, CHILD), "running");
  assert.deepEqual([bb.readsOf("thr_c_running"), bb.readsOf(CHILD)], [1, 1]);

  mock.timers.tick(500);
  bb.change("events-appended", CHILD);
  await settle();
  assert.deepEqual([bb.readsOf("thr_c_running"), bb.readsOf(CHILD)], [1, 1], "the throttle skips the read");

  mock.timers.tick(1_500);
  await settle();
  assert.deepEqual([bb.readsOf("thr_c_running"), bb.readsOf(CHILD)], [1, 2], "the trailing pull reads the child alone");
  stop();
});

test("a child's own change settles it; child subscriptions follow the view, and stop() removes them", async () => {
  const bb = fakeBb({ events: fixture.events });
  bb.serveChild(counter.running);
  const source = createThreadSource(bb.sdk, "thr_c_watch", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.deepEqual(bb.watched(), ["thr_c_watch", CHILD]);

  bb.serveChild(counter.settled);
  bb.change("events-appended", CHILD);
  await settle();
  assert.equal(statusOf(source, CHILD), "completed");

  bb.children = []; // archived or hidden: it leaves the list
  bb.change("events-appended");
  await settle();
  assert.deepEqual(bb.watched(), ["thr_c_watch"]);
  assert.equal(statusOf(source, CHILD), undefined);

  bb.serveChild(counter.running);
  bb.change("events-appended");
  await settle();
  assert.deepEqual(bb.watched(), ["thr_c_watch", CHILD]);
  stop();
  assert.deepEqual(bb.watched(), []);
});

test("a child's status-only change settles it, with no events and no pull owed", async () => {
  const bb = fakeBb({ events: fixture.events });
  bb.serveChild(counter.running);
  const source = createThreadSource(bb.sdk, "thr_c_status", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.equal(statusOf(source, CHILD), "running");

  mock.timers.tick(5_000);
  bb.serveChild(counter.settled);
  bb.change("status-changed", CHILD);
  await settle();
  assert.equal(statusOf(source, CHILD), "completed");
  stop();
});

test("this thread's lifecycle reads leave a running child's reread deadline alone", async () => {
  const [started] = fixture.events.filter((e) => e.seq === 2927); // a delegation starts: a lifecycle event
  const bb = fakeBb({ events: fixture.events.filter((e) => e.seq < started.seq) });
  bb.serveChild(counter.running);
  const stop = createThreadSource(bb.sdk, "thr_c_deadline", () => {}).subscribe(() => {});
  await settle();
  assert.deepEqual([bb.readsOf("thr_c_deadline"), bb.readsOf(CHILD)], [1, 1]);

  mock.timers.tick(1_500);
  bb.events.push(started);
  bb.change("events-appended", "thr_c_deadline");
  await settle();
  assert.deepEqual([bb.readsOf("thr_c_deadline"), bb.readsOf(CHILD)], [2, 1], "the lifecycle event rereads this thread only");

  mock.timers.tick(500);
  await settle();
  assert.equal(bb.readsOf(CHILD), 2, "the child is due 2 s after its own last read");
  stop();
});

test("a failed child read commits nothing, and the next change retries it", async () => {
  const bb = fakeBb({ events: fixture.events });
  bb.serveChild(counter.running);
  const source = createThreadSource(bb.sdk, "thr_c_fail", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.equal(statusOf(source, CHILD), "running");

  bb.serveChild(counter.settled);
  bb.failTimelineOf = CHILD;
  bb.change("events-appended", CHILD);
  await settle();
  assert.equal(statusOf(source, CHILD), "running", "the failed pull changes nothing");

  bb.change("events-appended", CHILD);
  await settle();
  assert.equal(statusOf(source, CHILD), "completed");
  stop();
});

// ---------------------------------------------------------------- fake bb

const EVENT_PAGE = 100;

type TaskCompleted = Extract<EventRow, { type: "item/backgroundTask/completed" }>;
type SubscribeArgs = Parameters<ThreadSdk["subscribe"]>[0];
type EventsQuery = Parameters<ThreadSdk["threads"]["events"]["list"]>[0];
type TimelineQuery = Parameters<ThreadSdk["threads"]["timeline"]>[0];
type Watch = { threadId: string | undefined; callback: (change: ThreadChange) => void };

function fakeBb(init: { rows?: TimelineRow[]; events: EventRow[] }) {
  const watches = new Set<Watch>();
  let held: Promise<void> | null = null;
  const sdk: ThreadSdk = {
    subscribe: (args: SubscribeArgs) => {
      if (args.event !== "thread:changed") return () => {};
      const watch = { threadId: args.threadId, callback: args.callback };
      watches.add(watch);
      return () => watches.delete(watch);
    },
    threads: {
      get: async () => {
        state.reads++;
        return { providerId: "claude-code" };
      },
      events: {
        list: async (query: EventsQuery) => {
          state.reads++;
          await held;
          const afterSeq = Number(query.afterSeq ?? -1);
          if (afterSeq === state.failEventsAfter) {
            state.failEventsAfter = null;
            throw new Error("events page failed");
          }
          return state.events
            .filter((e) => e.seq > afterSeq && (query.types ?? [e.type]).includes(e.type))
            .slice(0, Number(query.limit));
        },
      },
      timeline: async (query: TimelineQuery) => {
        const { threadId } = query;
        state.reads++;
        state.timelineReads++;
        timelineReadsOf.set(threadId, state.readsOf(threadId) + 1);
        state.lastQuery.set(threadId, query);
        if (state.failTimeline || state.failTimelineOf === threadId) {
          state.failTimeline = false;
          state.failTimelineOf = null;
          throw new Error("timeline failed");
        }
        return { rows: childRows.get(threadId) ?? state.rows };
      },
      list: async () => {
        state.reads++;
        return state.children;
      },
    },
  };
  const timelineReadsOf = new Map<string, number>();
  const childRows = new Map<string, TimelineRow[]>();
  const state = {
    sdk,
    rows: init.rows ?? fixture.rows,
    events: [...init.events],
    failEventsAfter: null as number | null,
    failTimeline: false,
    failTimelineOf: null as string | null,
    children: [] as ChildThread[],
    lastQuery: new Map<string, TimelineQuery>(),
    /** Every SDK read, of any kind. */
    reads: 0,
    timelineReads: 0,
    readsOf(threadId: string): number {
      return timelineReadsOf.get(threadId) ?? 0;
    },
    /** Lists the child as it was at this read, and serves its rows. */
    serveChild({ child, rows }: ChildRead) {
      state.children = [child];
      childRows.set(child.id, rows);
    },
    /** The threads with a thread:changed subscription. */
    watched(): (string | undefined)[] {
      return [...watches].map((watch) => watch.threadId);
    },
    /** A change to one thread, or to every watched thread. */
    change(kind: ThreadChange["changes"][number], threadId?: string) {
      for (const watch of watches) {
        if (threadId === undefined || watch.threadId === threadId) watch.callback({ entity: "thread", type: "changed", changes: [kind] });
      }
    },
    /** Holds every events read until the returned release is called. */
    holdEvents(): () => void {
      let release = () => {};
      held = new Promise<void>((resolve) => (release = resolve));
      return () => {
        held = null;
        release();
      };
    },
  };
  return state;
}

/** The task's progress events in the seqs just before its completion: it is still running. */
function progressBefore(completed: TaskCompleted, count: number): EventRow[] {
  return Array.from({ length: count }, (_, i) => {
    const seq = completed.seq - count + i;
    const item = { ...completed.data.item, status: "pending" as const, taskStatus: "running" as const };
    return { ...completed, id: `evt_progress_${seq}`, seq, type: "item/backgroundTask/progress", data: { ...completed.data, item } };
  });
}

function withDelegationStatus(row: TimelineRow, status: DelegationRow["status"]): TimelineRow {
  if (row.kind !== "turn" || !row.children) return row;
  const pending = (child: DelegationRow): DelegationRow => ({ ...child, status, completedAt: null });
  const children = row.children.map((child) => (child.kind === "work" && child.workKind === "delegation" ? pending(child) : child));
  return { ...row, children };
}

function delegatesOf(source: ThreadSource): readonly Delegate[] {
  const { snapshot } = source;
  assert.equal(snapshot.status, "ready");
  return snapshot.status === "ready" ? snapshot.delegates : [];
}

function statusOf(source: ThreadSource, id: string): DelegateStatus | undefined {
  return delegatesOf(source).find((d) => d.id === id)?.state.status;
}

/** Lets the source's pending SDK promises run to the end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

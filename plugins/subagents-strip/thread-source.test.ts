// The live thread source, through its public surface, against a fake browser
// SDK that serves the trimmed real capture (see normalise.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { DelegationRow, EventRow, ThreadChange, ThreadSdk, TimelineRow } from "./bb.ts";
import type { Delegate, DelegateStatus } from "./delegate.ts";
import { createThreadSource, type ThreadSource } from "./thread-source.ts";

const fixture: { rows: TimelineRow[]; events: EventRow[] } = JSON.parse(
  readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"),
);

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

// ---------------------------------------------------------------- fake bb

const EVENT_PAGE = 100;

type TaskCompleted = Extract<EventRow, { type: "item/backgroundTask/completed" }>;
type SubscribeArgs = Parameters<ThreadSdk["subscribe"]>[0];
type EventsQuery = Parameters<ThreadSdk["threads"]["events"]["list"]>[0];

function fakeBb(init: { rows?: TimelineRow[]; events: EventRow[] }) {
  const onChange = new Set<(change: ThreadChange) => void>();
  let held: Promise<void> | null = null;
  const sdk: ThreadSdk = {
    subscribe: (args: SubscribeArgs) => {
      if (args.event !== "thread:changed") return () => {};
      const { callback } = args;
      onChange.add(callback);
      return () => onChange.delete(callback);
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
      timeline: async () => {
        state.reads++;
        state.timelineReads++;
        if (state.failTimeline) {
          state.failTimeline = false;
          throw new Error("timeline failed");
        }
        return { rows: state.rows };
      },
    },
  };
  const state = {
    sdk,
    rows: init.rows ?? fixture.rows,
    events: [...init.events],
    failEventsAfter: null as number | null,
    failTimeline: false,
    /** Every SDK read, of any kind. */
    reads: 0,
    timelineReads: 0,
    change(kind: ThreadChange["changes"][number]) {
      onChange.forEach((callback) => callback({ entity: "thread", type: "changed", changes: [kind] }));
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

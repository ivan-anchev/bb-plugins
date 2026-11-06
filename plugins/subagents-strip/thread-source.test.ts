// The live thread source, through its public surface, against a fake browser
// SDK that serves the trimmed real captures (see normalise.test.ts and child-threads.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { ChildThread, DelegationRow, EventRow, OlderCursor, ThreadChange, ThreadSdk, TimelineRead, TimelineRow } from "./bb.ts";
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
  assert.equal(bb.lastQuery.get(CHILD)?.deferContent, "true", "a child's row never shows what deferred content leaves out");

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

// ---------------------------------------------------------------- history before the live window

// The fixture's seven turn rows as bb pages them: the live window holds the last three, the page before it
// two, and the first page the first two plus a cut copy of the third, as bb's pages overlap at their edges.
const LIVE = fixture.rows.slice(4);
const PAGES = [fixture.rows.slice(2, 4), [...fixture.rows.slice(0, 2), withoutChildren(fixture.rows[2])]];

test("on start the history is read in outline, so every delegate counts at once; wanted, it is read in full, once", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_walk", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.deepEqual(bb.pageReads(), ["outline:page-0", "outline:page-1"]);
  assert.equal(delegatesOf(source).length, 8, "every delegate in the thread, before the tab opens");
  assert.deepEqual(turnsOf(source), fixture.rows.map((row) => row.turnId));
  assert.equal(outlinedOf(source).size, 5, "the five delegates before the live window wait for their steps");
  assert.ok(delegatesOf(source).every((d) => outlinedOf(source).has(d.id) === (d.steps === null)), "outlined ones have no steps yet");

  const release = source.wantHistory();
  await settle();
  assert.deepEqual(bb.pageReads().slice(2), ["page-0", "page-1"]);
  assert.equal(delegatesOf(source).length, 8, "the overlapping turn's from both its copies");
  assert.equal(outlinedOf(source).size, 0);
  assert.ok(delegatesOf(source).every((d) => d.steps !== null && d.steps.length > 0));

  release();
  const again = source.wantHistory();
  bb.events.push(delegationStarted());
  bb.change("events-appended");
  await settle();
  const liveReads = bb.queries.filter((q) => q.beforeAnchorId === undefined && q.deferContent === undefined);
  assert.equal(liveReads.length, 3, "live reads: the first, the full history's fresh one, and this pull's");
  assert.equal(bb.pageReads().length, 4, "a finished history stays: neither wanting it again nor a later pull reads a page");
  assert.equal(outlinedOf(source).size, 0);
  again();
  stop();
});

test("rows that slide out of the live window stay with the history; a rewrite drops it and reads it again", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_slide", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  const release = source.wantHistory();
  await settle();

  // A new turn pushes the window's oldest turn out: bb now starts the window one turn later.
  bb.rows = LIVE.slice(1);
  bb.olderPages = [fixture.rows.slice(3, 5), ...PAGES];
  bb.events.push(delegationStarted());
  bb.change("events-appended");
  await settle();
  assert.deepEqual(turnsOf(source), fixture.rows.map((row) => row.turnId), "the turn that slid out is kept");
  assert.equal(bb.pageReads().length, 4);

  bb.change("history-rewritten");
  await settle();
  assert.deepEqual(bb.pageReads().slice(4), ["page-0", "page-1", "page-2"], "the rewrite reads the history again in full, from a fresh cursor");
  assert.equal(outlinedOf(source).size, 0);
  release();
  stop();
});

test("a turn bb pages in two fragments keeps both: its delegates and a delegation's child rows from each page", async () => {
  // The fixture's second turn, cut where bb cut thr_24dxq5xhph's `daeac18995-t5:turn` (26 children in the newer
  // page, 10 in the older, 1 shared): its first delegation's child rows split across the pages, its second in the newer.
  const turn = fixture.rows[1];
  assert.ok(turn.kind === "turn" && turn.children?.length === 2, "fixture premise: a turn of two delegations");
  const [first, second] = turn.children.filter(isDelegationRow);
  const half = Math.floor((first.childRows?.length ?? 0) / 2);
  const older = { ...turn, children: [{ ...first, childRows: first.childRows?.slice(0, half) ?? null }] };
  const newer = { ...turn, children: [{ ...first, childRows: first.childRows?.slice(half) ?? null }, second] };
  const split = await historyRead([fixture.rows.slice(2, 4), [fixture.rows[0], newer], [older]]);
  const whole = await historyRead(PAGES);
  assert.equal(split.length, 8, "every delegate in the thread");
  assert.deepEqual(split.find((d) => d.id === first.callId)?.steps, whole.find((d) => d.id === first.callId)?.steps);
});

test("an update bb sends for an older row adds to what was read: its other descendants stay", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_update", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  source.wantHistory();
  await settle();
  assert.equal(delegatesOf(source).length, 8);

  // The fixture's second turn gains a third delegation; bb's update carries the turn with only that child.
  const turn = fixture.rows[1];
  assert.ok(turn.kind === "turn" && turn.children, "fixture premise: a turn group");
  const [, last] = turn.children.filter(isDelegationRow);
  const third: DelegationRow = { ...last, id: `${last.id}-again`, callId: `${last.callId}-again`, childRef: `${last.childRef}-again` };
  bb.olderRowUpdates = [{ ...turn, children: [third] }];
  bb.events.push(delegationStarted());
  bb.change("events-appended");
  await settle();
  assert.equal(delegatesOf(source).length, 9, "the turn's two delegates and the new one");
  stop();
});

test("stopping the source mid-history ends the walk: no page read after it", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_stop", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  const release = bb.holdPages();
  source.wantHistory();
  await settle();
  stop();
  release();
  await settle();
  assert.deepEqual(bb.pageReads(), ["outline:page-0", "outline:page-1", "page-0"]);
});

test("the last reader leaving mid-walk aborts the read in flight: no page after it, and the outline stays", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_leave", () => {});
  const stop = source.subscribe(() => {}); // the strip, which stays
  await settle();
  const release = bb.holdPages();
  const leave = source.wantHistory(); // the tab, showing
  await settle();
  assert.deepEqual(bb.pageReads(), ["outline:page-0", "outline:page-1", "page-0"], "the walk is under way");
  leave(); // the tab, hidden
  await settle();
  assert.deepEqual(bb.abortedPageReads(), ["page-0"], "the read in flight is aborted");
  release();
  await settle();
  assert.deepEqual(bb.pageReads(), ["outline:page-0", "outline:page-1", "page-0"], "no page is read after it");
  assert.equal(source.snapshot.status, "ready", "a cancelled walk is no failure");
  assert.equal(outlinedOf(source).size, 5, "the history held is still the outline");
  assert.equal(delegatesOf(source).length, 8);
  stop();
});

test("wanted again after a cancelled walk, the history is read in full from a fresh cursor", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_again", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  const release = bb.holdPages();
  const hide = source.wantHistory();
  await settle();
  hide();
  release();
  await settle();
  const liveReadsBefore = bb.queries.filter((q) => q.beforeAnchorId === undefined && q.deferContent === undefined).length;
  const leave = source.wantHistory();
  await settle();
  assert.deepEqual(bb.pageReads().slice(3), ["page-0", "page-1"], "a whole new walk, from its first page");
  const liveReads = bb.queries.filter((q) => q.beforeAnchorId === undefined && q.deferContent === undefined).length;
  assert.equal(liveReads, liveReadsBefore + 1, "from a fresh live read's cursor, never the cancelled walk's");
  assert.equal(outlinedOf(source).size, 0);
  assert.ok(delegatesOf(source).every((d) => d.steps !== null && d.steps.length > 0));
  leave();
  stop();
});

test("a reader leaving mid-walk after a rewrite dropped the history still leaves the outline read, so every delegate counts", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_rewrite", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  const leave = source.wantHistory();
  await settle();
  const release = bb.holdPages();
  bb.change("history-rewritten"); // the reload drops the history, then walks it in full while the tab wants it
  await settle();
  leave();
  await settle();
  release();
  await settle();
  assert.deepEqual(bb.abortedPageReads(), ["page-0"]);
  assert.deepEqual(bb.pageReads().slice(4), ["page-0", "outline:page-0", "outline:page-1"], "the outline, read in its place");
  assert.equal(delegatesOf(source).length, 8);
  assert.equal(outlinedOf(source).size, 5);
  stop();
});

test("a reader leaving while another still wants the history leaves the walk running", async () => {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = PAGES;
  const source = createThreadSource(bb.sdk, "thr_h_two", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  const release = bb.holdPages();
  const first = source.wantHistory();
  const second = source.wantHistory();
  await settle();
  first();
  first(); // releasing twice counts once
  release();
  await settle();
  assert.deepEqual(bb.abortedPageReads(), []);
  assert.equal(outlinedOf(source).size, 0, "the walk finished");
  second();
  stop();
});

test("a thread the live window holds whole has no history to read", async () => {
  const bb = fakeBb({ events: fixture.events });
  const source = createThreadSource(bb.sdk, "thr_h_whole", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  assert.equal(outlinedOf(source).size, 0, "nothing waits on a history");
  source.wantHistory();
  await settle();
  assert.deepEqual(bb.pageReads(), []);
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
  let heldPages: Promise<void> | null = null;
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
        state.queries.push(query);
        if (query.beforeAnchorId !== undefined && heldPages) await untilAborted(heldPages, query, state);
        if (state.failTimeline || state.failTimelineOf === threadId) {
          state.failTimeline = false;
          state.failTimelineOf = null;
          throw new Error("timeline failed");
        }
        return childRows.has(threadId) ? page(childRows.get(threadId) ?? [], null) : state.read(query);
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
    /** This thread's pages before the live window, newest first; [] when the window holds the thread. */
    olderPages: [] as TimelineRow[][],
    /** What the live read reports as changed in older rows. */
    olderRowUpdates: undefined as TimelineRow[] | undefined,
    /** The live window, or the older page a query's cursor names; each cursor names the page after it. */
    read(query: TimelineQuery): TimelineRead {
      const mode = query.deferContent === "true" ? "outline:" : "";
      // why: as bb, a cursor pages only reads of its own kind ("Timeline pagination cursor is no longer available").
      if (query.beforeAnchorId !== undefined && !query.beforeAnchorId.startsWith(`${mode}page-`)) throw new Error("cursor of another kind");
      const at = query.beforeAnchorId === undefined ? -1 : Number(query.beforeAnchorId.slice(`${mode}page-`.length));
      const served = at === -1 ? state.rows : state.olderPages[at];
      // why: bb's deferred content leaves out a delegation's child rows (live, thr_24dxq5xhph).
      const rows = mode ? served.map(withoutChildRows) : served;
      const cursor = at + 1 < state.olderPages.length ? { anchorId: `${mode}page-${at + 1}`, anchorSeq: rows[0].sourceSeqStart } : null;
      return at === -1 ? { ...page(rows, cursor), timelinePage: { olderCursor: cursor, olderRowUpdates: state.olderRowUpdates } } : page(rows, cursor);
    },
    /** The cursors of the older-page reads that were aborted while held, in order. */
    abortedPageReads(): string[] {
      return state.aborted.flatMap((q) => (q.beforeAnchorId === undefined ? [] : [q.beforeAnchorId]));
    },
    aborted: [] as TimelineQuery[],
    /** The cursors of the older-page reads, in order; "outline:" marks a deferred-content one. */
    pageReads(): string[] {
      return state.queries.flatMap((q) => (q.beforeAnchorId === undefined ? [] : [q.beforeAnchorId]));
    },
    queries: [] as TimelineQuery[],
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
    /** Holds every older-page read until the returned release is called. */
    holdPages(): () => void {
      let release = () => {};
      heldPages = new Promise<void>((resolve) => (release = resolve));
      return () => {
        heldPages = null;
        release();
      };
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

/** Waits for `held`, or rejects as fetch does once the query's signal aborts, recording the query. */
function untilAborted(held: Promise<void>, query: TimelineQuery, state: { aborted: TimelineQuery[] }): Promise<void> {
  const { signal } = query;
  if (!signal) return held;
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      state.aborted.push(query);
      reject(signal.reason);
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    void held.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

/** A delegation starting after every fixture event: a lifecycle event, so the pull rereads the live window. */
function delegationStarted(): EventRow {
  const started = fixture.events.find((e) => e.seq === 2927);
  assert.ok(started, "fixture premise: a delegation's item/started event");
  const seq = Math.max(...fixture.events.map((e) => e.seq)) + 1;
  return { ...started, id: `evt_started_${seq}`, seq };
}

function withoutChildRows(row: TimelineRow): TimelineRow {
  if (row.kind === "turn") return { ...row, children: row.children && row.children.map(withoutChildRows) };
  return isDelegationRow(row) ? { ...row, childRows: null } : row;
}

function outlinedOf(source: ThreadSource): ReadonlySet<string> {
  const { snapshot } = source;
  assert.equal(snapshot.status, "ready");
  return snapshot.status === "ready" ? snapshot.outlined : new Set();
}

function withoutChildren(row: TimelineRow): TimelineRow {
  assert.ok(row.kind === "turn", "fixture premise: a turn row");
  return { ...row, children: [] };
}

function turnsOf(source: ThreadSource): (string | null)[] {
  const { snapshot } = source;
  assert.equal(snapshot.status, "ready");
  return snapshot.status === "ready" ? snapshot.turns.map((turn) => turn.id) : [];
}

/** A source's delegates once it has read the whole history from `pages`, with the live window LIVE. */
async function historyRead(pages: TimelineRow[][]): Promise<readonly Delegate[]> {
  const bb = fakeBb({ rows: LIVE, events: fixture.events });
  bb.olderPages = pages;
  const source = createThreadSource(bb.sdk, "thr_h_pages", () => {});
  const stop = source.subscribe(() => {});
  await settle();
  source.wantHistory();
  await settle();
  const delegates = delegatesOf(source);
  stop();
  return delegates;
}

function isDelegationRow(row: TimelineRow): row is DelegationRow {
  return row.kind === "work" && row.workKind === "delegation";
}

function page(rows: TimelineRow[], olderCursor: OlderCursor): TimelineRead {
  return { rows, timelinePage: { olderCursor } };
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

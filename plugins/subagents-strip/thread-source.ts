// One thread's delegates, kept live from bb: task events and the child-thread
// list are pulled cheaply on every change; timeline rows (the thread's own and
// each child's) only when a delegate starts or settles, or on a throttle, per
// timeline, while it runs. That live read is bounded to the latest segments.
// The history before them is read on start in outline (every delegate and
// message, ~0.1 KB a row), and in full while a reader wants it.
import type { ChildThread, DelegationRow, EventRow, OlderCursor, ThreadChange, ThreadSdk, TimelineRead, TimelineRow } from "./bb.ts";
import { childDelegate, childrenInView, threadRunning } from "./child-threads.ts";
import type { Delegate, DelegateId, ThreadDelegates } from "./delegate.ts";
import { TASK_EVENT_TYPES, foldTaskEvents, normalise, turnsOf, type TaskLedger } from "./normalise.ts";
import { isRunning } from "./roster.ts";

/** One thread's delegates, live while it has subscribers. */
export interface ThreadSource {
  readonly snapshot: ThreadDelegates;
  /** The first subscriber starts the source; the last to leave stops it and calls `onIdle`. */
  subscribe(listener: () => void): () => void;
  /**
   * Wants the thread's history before the live window in full, back to its first row (the outline read on
   * start leaves out a delegation's steps and report), until the returned release. A walk starts on the next
   * pull while anyone wants it, from a fresh read; once the last want is released, a walk still under way is
   * aborted and its rows dropped. A walk that finished stays: the full rows are kept, also with no one wanting
   * them, until a rewrite drops them.
   */
  wantHistory(): () => void;
}

export function createThreadSource(sdk: ThreadSdk, threadId: string, onIdle: () => void): ThreadSource {
  return new LiveThreadSource(sdk, threadId, onIdle);
}

// ---------------------------------------------------------------- the source (layer 2)

// why: bounds the live read, which reruns on every delegate lifecycle event and on the running throttle.
const SEGMENT_LIMIT = "20";
// why: a nested timeline read is up to ~2 MB on heavy threads; timers tick locally anyway.
const RUNNING_REREAD_MS = 2_000;
// why: the events route refuses a larger page.
const EVENT_PAGE = 100;

type Pull = "refresh" | "reload";
/**
 * The history before the live window as read: an outline (bb's deferred content: every delegation and
 * message, without a delegation's child rows, so its steps and report wait) or the full rows.
 */
type Older = { rows: readonly TimelineRow[]; detail: "outline" | "full" };
/** A child's rows as last read, and the child's updatedAt they were read at. */
type ChildRead = { version: number; rows: readonly TimelineRow[] };
/** A child in view with its rows: what childDelegate is built from. */
type ReadChild = { child: ChildThread; read: ChildRead };

class LiveThreadSource implements ThreadSource {
  snapshot: ThreadDelegates = { status: "loading" };
  private readonly sdk: ThreadSdk;
  private readonly threadId: string;
  private readonly onIdle: () => void;
  private readonly listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  // why: one per start; stop() aborts it, which cancels the reads in flight and ends their pull.
  private lifetime = new AbortController();
  private providerId: string | null = null;
  private ledger: TaskLedger = new Map();
  private afterSeq: number | null = null;
  /** The live window: this thread's latest segments, reread as it changes. */
  private rows: readonly TimelineRow[] = [];
  /** Where the rows before the live window begin; null when it holds the whole thread. */
  private liveCursor: OlderCursor = null;
  /** The history before the live window, oldest first; null before the first pull and after a rewrite. */
  private older: Older | null = null;
  /** How many readers want the full history; while any do, `historyDemand` is theirs. */
  private historyReaders = 0;
  // why: one per run of wanting; the last release aborts it, which cancels the walk's read in flight and ends the walk.
  private historyDemand = new AbortController();
  private children: readonly ChildThread[] = [];
  private childReads: ReadonlyMap<string, ChildRead> = new Map();
  // why: one thread:changed subscription per child in view, so a child settles whatever the parent hears.
  private readonly childWatches = new Map<string, () => void>();
  // why: one periodic reread deadline per timeline (this thread's and each child's), so a read of one never postpones another.
  private readonly lastReads = new Map<string, number>();
  private trailingRead: ReturnType<typeof setTimeout> | undefined;
  private queued: Pull | null = null;
  // why: a failed reload leaves the ledger and rows stale, so every pull reloads until one succeeds.
  private reloadOwed = false;
  private pulling = false;
  private failing = false;

  constructor(sdk: ThreadSdk, threadId: string, onIdle: () => void) {
    this.sdk = sdk;
    this.threadId = threadId;
    this.onIdle = onIdle;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start(): void {
    this.lifetime = new AbortController();
    this.stops = [
      this.sdk.subscribe({ event: "thread:changed", threadId: this.threadId, callback: (change) => this.onThreadChanged(change) }),
      this.sdk.subscribe({ event: "realtime:connection", callback: (c) => c.reconnected && this.request("refresh") }),
      listen(document, "visibilitychange", () => document.visibilityState === "visible" && this.request("refresh")),
    ];
    this.request("reload");
  }

  wantHistory(): () => void {
    if (this.historyReaders++ === 0) {
      this.historyDemand = new AbortController();
      if (this.older?.detail !== "full") this.request("refresh");
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.historyReaders === 0) this.historyDemand.abort();
    };
  }

  /** Leaves nothing behind: no subscription, no timer, no queued pull, and the pull in flight ends at its next read. */
  private stop(): void {
    this.lifetime.abort();
    this.stops.forEach((stop) => stop());
    this.childWatches.forEach((stop) => stop());
    this.childWatches.clear();
    clearTimeout(this.trailingRead);
    this.trailingRead = undefined;
    this.queued = null;
    this.onIdle(); // why: the next subscriber starts from a clean ledger
  }

  /**
   * This thread's or a child's change. A rewrite invalidates cached rows, so it reloads (and drops the child cache).
   * A status change refreshes too: a child can settle with no event after the last pull.
   */
  private onThreadChanged(change: ThreadChange): void {
    if (isRewrite(change)) this.request("reload");
    else if (change.changes.includes("events-appended") || change.changes.includes("status-changed")) this.request("refresh");
  }

  /** Single-flight: one pull at a time, and at most one trailing pull that covers every request made meanwhile. */
  private request(pull: Pull): void {
    this.queued = this.queued === "reload" ? "reload" : pull;
    if (!this.pulling) void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    this.pulling = true;
    for (let pull = this.queued; pull; pull = this.queued) {
      this.queued = null;
      await this.pull(pull);
    }
    this.pulling = false;
  }

  /** Reads into locals, then commits cursor, ledger, rows, children, and child rows together: a failure anywhere changes nothing. */
  private async pull(requested: Pull): Promise<void> {
    const { signal } = this.lifetime;
    const reload = requested === "reload" || this.reloadOwed;
    try {
      const providerId = (this.providerId ??= (await unlessStopped(signal, this.sdk.threads.get({ threadId: this.threadId, signal }))).providerId);
      const afterSeq = reload ? null : this.afterSeq;
      const events = await this.eventsAfter(afterSeq, signal);
      // why: a child is spawned by a command in this thread's turn and its end wakes this thread, so this
      // thread's changes cover both; its own subscription covers the rest. The list is ~1 KB per child.
      // Not paged: given no limit, the list route returns every match (1,777 threads in one read, live),
      // and for each parent read its length equals threads.count (thr_24dxq5xhph: 6 and 6).
      const children = await unlessStopped(signal, this.sdk.threads.list({ parentThreadId: this.threadId, archived: false, signal }));
      const heldOlder = reload ? null : this.older;
      const walk = olderWalk(heldOlder, this.historyReaders > 0);
      // why: a history read starts from a fresh live read, so its cursor belongs to the thread as it is now.
      const live = walk || this.needsRows(reload, events, children) ? await this.readRows(signal) : null;
      const rows = live?.rows ?? this.rows;
      const liveCursor = live ? live.timelinePage.olderCursor : this.liveCursor;
      const older = (walk && (await this.walkOlder(liveCursor, walk, heldOlder, signal))) ?? keepOlder(heldOlder, this.rows, live);
      const allRows = older ? joinRows(older.rows, rows) : rows;
      const inView = childrenInView(children, allRows);
      const readChildren = await this.readChildren(inView, reload ? new Map() : this.childReads, signal);
      this.afterSeq = events.at(-1)?.seq ?? afterSeq;
      this.ledger = foldTaskEvents(reload ? new Map() : this.ledger, events);
      this.rows = rows;
      this.liveCursor = liveCursor;
      this.older = older;
      this.children = children;
      this.childReads = new Map(readChildren.map(({ child, read }) => [child.id, read]));
      this.reloadOwed = false;
      this.failing = false;
      this.watchChildren(inView);
      const delegations = normalise(allRows, this.ledger, providerId);
      this.emit({
        status: "ready",
        delegates: [...delegations, ...readChildren.map(({ child, read }) => childDelegate(child, read.rows, allRows))],
        turns: turnsOf(allRows),
        outlined: older?.detail === "outline" ? outlinedOf(delegations, normalise(rows, this.ledger, providerId)) : NONE,
      });
    } catch (error) {
      if (signal.aborted) return; // why: stopped mid-pull; nobody is listening and nothing is owed
      // why: the one failure handler. Keep the last good snapshot; the next change retries.
      if (!this.failing) console.error("[subagents-strip]", error);
      this.failing = true;
      this.reloadOwed = reload;
      if (this.snapshot.status !== "ready") this.emit({ status: "failed", message: String(error) });
    }
  }

  /** Cheap: only the task events after `afterSeq`. */
  private async eventsAfter(afterSeq: number | null, signal: AbortSignal): Promise<EventRow[]> {
    const events: EventRow[] = [];
    for (let cursor = afterSeq; ; ) {
      const page = await unlessStopped(
        signal,
        this.sdk.threads.events.list({
          threadId: this.threadId,
          types: TASK_EVENT_TYPES,
          order: "asc",
          limit: String(EVENT_PAGE),
          ...(cursor === null ? {} : { afterSeq: String(cursor) }),
          signal,
        }),
      );
      events.push(...page);
      if (page.length < EVENT_PAGE) return events;
      cursor = page[page.length - 1].seq;
    }
  }

  /**
   * The throttle, asked only of a running timeline: while the window is visible, a reread is due
   * 2 s after that timeline's own last read. One it skips is owed: a single trailing pull takes it.
   */
  private rereadDue(threadId: string): boolean {
    if (document.visibilityState !== "visible") return false;
    const wait = (this.lastReads.get(threadId) ?? 0) + RUNNING_REREAD_MS - Date.now();
    if (wait <= 0) return true;
    this.trailingRead ??= setTimeout(() => {
      this.trailingRead = undefined;
      this.request("refresh");
    }, wait);
    return false;
  }

  /**
   * Heavy: this thread's rows are reread on a reload, a delegate lifecycle event, a child not seen
   * before (its spawning turn may be newer than the rows held), or when due while a delegation runs.
   */
  // why: a running child alone never rereads this thread's nested timeline (up to ~2 MB); only its own rows.
  private needsRows(reload: boolean, events: readonly EventRow[], children: readonly ChildThread[]): boolean {
    if (reload || events.some(isDelegateLifecycle)) return true;
    if (children.some((child) => !this.children.some((known) => known.id === child.id))) return true;
    return this.delegationRunning() && this.rereadDue(this.threadId);
  }

  /**
   * Each child in view, from the cache while it is current: read again when it is new, its updatedAt
   * moved (it started, settled, or was renamed), or when due while it runs. Reads run in parallel.
   */
  private async readChildren(
    inView: readonly ChildThread[],
    cache: ReadonlyMap<string, ChildRead>,
    signal: AbortSignal,
  ): Promise<ReadChild[]> {
    return Promise.all(
      inView.map(async (child): Promise<ReadChild> => {
        const cached = cache.get(child.id);
        if (cached && cached.version === child.updatedAt && !(threadRunning(child) && this.rereadDue(child.id))) return { child, read: cached };
        return { child, read: { version: child.updatedAt, rows: await this.readChildRows(child.id, signal) } };
      }),
    );
  }

  /** Subscribes to each child in view and drops children that left it; runs after commit, so a stopped source never subscribes. */
  private watchChildren(inView: readonly ChildThread[]): void {
    const ids = new Set(inView.map((child) => child.id));
    for (const [id, unsubscribe] of this.childWatches) {
      if (ids.has(id)) continue;
      unsubscribe();
      this.childWatches.delete(id);
    }
    for (const id of ids) {
      if (this.childWatches.has(id)) continue;
      this.childWatches.set(id, this.sdk.subscribe({ event: "thread:changed", threadId: id, callback: (change) => this.onThreadChanged(change) }));
    }
  }

  /** Whether a delegate from this thread's own rows runs, as of the last snapshot. */
  private delegationRunning(): boolean {
    return this.snapshot.status === "ready" && this.snapshot.delegates.some((d) => d.origin.kind === "delegation" && isRunning(d));
  }

  /** The one place this thread's live window is read. */
  private async readRows(signal: AbortSignal): Promise<TimelineRead> {
    this.lastReads.set(this.threadId, Date.now());
    return this.readWindow({}, signal);
  }

  /**
   * The history walk a pull makes. A full walk reads only while it is wanted: when the last reader releases
   * it mid-walk, null, so the pull commits everything else and keeps the history it held.
   */
  private async walkOlder(cursor: OlderCursor, detail: Older["detail"], held: Older | null, lifetime: AbortSignal): Promise<Older | null> {
    if (detail === "outline") return { rows: await this.readOlder(cursor, detail, lifetime), detail };
    const demand = this.historyDemand.signal;
    try {
      return { rows: await this.readOlder(cursor, detail, AbortSignal.any([lifetime, demand])), detail };
    } catch (error) {
      if (!demand.aborted || lifetime.aborted) throw error;
      // why: with nothing held (a first pull, or one after a rewrite), the counts need the outline, so it is read instead.
      return held ? null : this.walkOlder(cursor, "outline", held, lifetime);
    }
  }

  /**
   * Every row before the live window, oldest first, read page by page in one go: in full from the live
   * read's `cursor`; in outline, bb's deferred content, which leaves out a delegation's child rows (live,
   * thr_24dxq5xhph: 6 pages, 659 KB, every delegation and message; in full, 7 pages, about 12 MB).
   * why: a cursor names the thread as it was at its read, and bb rebuilds that state to serve a stale one
   * (live, once: over 120 s, while a live read of the same thread timed out at 30 s), so no cursor is kept
   * for later; each walk starts from a fresh read.
   */
  private async readOlder(cursor: OlderCursor, detail: Older["detail"], signal: AbortSignal): Promise<readonly TimelineRow[]> {
    if (cursor === null) return []; // the live window holds the whole thread
    const deferContent = detail === "outline" ? { deferContent: "true" as const } : {};
    // why: bb refuses a cursor in a read of the other kind ("Timeline pagination cursor is no longer available"),
    // so the outline starts from its own read of the latest segments, whose rows the live window already holds.
    const start = detail === "outline" ? (await this.readWindow(deferContent, signal)).timelinePage.olderCursor : cursor;
    let rows: readonly TimelineRow[] = [];
    for (let next = start; next !== null; ) {
      const page = await this.readWindow({ ...deferContent, beforeAnchorId: next.anchorId, beforeAnchorSeq: String(next.anchorSeq) }, signal);
      rows = joinRows(page.rows, rows);
      next = page.timelinePage.olderCursor;
    }
    return rows;
  }

  /** One read of this thread's timeline, nested and segment-bounded like the live one. */
  private readWindow(
    query: Pick<Parameters<ThreadSdk["threads"]["timeline"]>[0], "deferContent" | "beforeAnchorId" | "beforeAnchorSeq">,
    signal: AbortSignal,
  ): Promise<TimelineRead> {
    return unlessStopped(signal, this.sdk.threads.timeline({ threadId: this.threadId, includeNestedRows: "true", segmentLimit: SEGMENT_LIMIT, ...query, signal }));
  }

  /**
   * A child's own rows, with the same segment bound. Nested, because a settled turn comes back
   * collapsed (`children: null`) without it, which would leave a finished child no steps. Deferred,
   * because a child's row never shows what that leaves out, such as a command's output: live, its 14
   * children in thr_24dxq5xhph read the same status, steps, and report either way, at a tenth the size.
   */
  private async readChildRows(threadId: string, signal: AbortSignal): Promise<readonly TimelineRow[]> {
    this.lastReads.set(threadId, Date.now());
    const timeline = await unlessStopped(
      signal,
      this.sdk.threads.timeline({ threadId, includeNestedRows: "true", deferContent: "true", segmentLimit: SEGMENT_LIMIT, signal }),
    );
    return timeline.rows;
  }

  private emit(next: ThreadDelegates): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

// ---------------------------------------------------------------- helpers (layer 3)

/**
 * Older rows, then the newer ones not among them. bb pages a turn's children, and a delegation's child rows,
 * in fragments, so a row both hold is merged: the newer copy's fields, and the children of both, recursively.
 */
function joinRows(older: readonly TimelineRow[], newer: readonly TimelineRow[]): readonly TimelineRow[] {
  const newerById = new Map(newer.map((row) => [row.id, row]));
  const olderIds = new Set(older.map((row) => row.id));
  return [
    ...older.map((row) => {
      const copy = newerById.get(row.id);
      return copy ? mergeRow(row, copy) : row;
    }),
    ...newer.filter((row) => !olderIds.has(row.id)),
  ];
}

/** One row read twice: the newer copy, holding the children of both. */
function mergeRow(older: TimelineRow, newer: TimelineRow): TimelineRow {
  if (older.kind === "turn" && newer.kind === "turn") return { ...newer, children: joinNested(older.children, newer.children) };
  if (isDelegationRow(older) && isDelegationRow(newer)) return { ...newer, childRows: joinNested(older.childRows, newer.childRows) };
  return newer;
}

/** Nested rows from two reads; a read that left them out (null) keeps the other's. */
function joinNested(older: TimelineRow[] | null, newer: TimelineRow[] | null): TimelineRow[] | null {
  if (older === null) return newer;
  if (newer === null) return older;
  return [...joinRows(older, newer)];
}

const isDelegationRow = (row: TimelineRow): row is DelegationRow => row.kind === "work" && row.workKind === "delegation";

/** Which history walk a pull makes: an outline when none is held, the full rows once wanted, or none. */
function olderWalk(held: Older | null, fullWanted: boolean): Older["detail"] | null {
  if (fullWanted && held?.detail !== "full") return "full";
  return held === null ? "outline" : null;
}

/**
 * The history held across a pull: as it was when the live window was not reread; across a new live read,
 * plus the rows that slid out of the window, those that end before its new start (bb's rule; a running
 * turn's flat rows, grouped into a turn row since, end inside it), with bb's updates to older rows applied.
 */
function keepOlder(older: Older | null, previous: readonly TimelineRow[], live: TimelineRead | null): Older | null {
  if (older === null || live === null) return older;
  const { olderCursor } = live.timelinePage;
  if (olderCursor === null) return { rows: [], detail: older.detail }; // the live window holds the whole thread
  const start = olderCursor.anchorSeq;
  const slid = joinRows(older.rows, previous.filter((row) => row.sourceSeqEnd < start));
  // why: an update carries only the descendants that changed, so it merges into the row held rather than replacing it.
  return { rows: joinRows(slid, live.timelinePage.olderRowUpdates ?? []), detail: older.detail };
}

/** The delegations read from the outline alone: those the live window, read in full, does not hold. */
function outlinedOf(all: readonly Delegate[], live: readonly Delegate[]): ReadonlySet<DelegateId> {
  const read = new Set(live.map((d) => d.id));
  return new Set(all.flatMap((d) => (read.has(d.id) ? [] : [d.id])));
}

const NONE: ReadonlySet<DelegateId> = new Set();

/** An SDK read whose result is refused if the source stopped while it was in flight. */
async function unlessStopped<T>(signal: AbortSignal, read: Promise<T>): Promise<T> {
  const result = await read;
  signal.throwIfAborted();
  return result;
}

function isRewrite(change: ThreadChange): boolean {
  return change.changes.includes("history-rewritten") || change.changes.includes("history-compacted");
}

/** A new delegate or task starts, or a task completes (its report must be read now). */
function isDelegateLifecycle(event: EventRow): boolean {
  if (event.type === "item/backgroundTask/completed") return true;
  return event.type === "item/started" && (event.data.item.type === "delegation" || event.data.item.type === "backgroundTask");
}

function listen(target: EventTarget, type: string, handler: () => void): () => void {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

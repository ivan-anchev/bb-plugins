// One thread's delegates, kept live from bb: task events and the child-thread
// list are pulled cheaply on every change; timeline rows (the thread's own and
// each child's) only when a delegate starts or settles, or on a throttle, per
// timeline, while it runs.
import type { ChildThread, EventRow, ThreadChange, ThreadSdk, TimelineRow } from "./bb.ts";
import { childDelegate, childrenInView, threadRunning } from "./child-threads.ts";
import type { ThreadDelegates } from "./delegate.ts";
import { TASK_EVENT_TYPES, foldTaskEvents, normalise, type TaskLedger } from "./normalise.ts";
import { isRunning } from "./roster.ts";

/** One thread's delegates, live while it has subscribers. */
export interface ThreadSource {
  readonly snapshot: ThreadDelegates;
  /** The first subscriber starts the source; the last to leave stops it and calls `onIdle`. */
  subscribe(listener: () => void): () => void;
}

export function createThreadSource(sdk: ThreadSdk, threadId: string, onIdle: () => void): ThreadSource {
  return new LiveThreadSource(sdk, threadId, onIdle);
}

// ---------------------------------------------------------------- the source (layer 2)

// why: the roster needs the latest delegating turn plus running ones; this bounds the read.
const SEGMENT_LIMIT = "20";
// why: a nested timeline read is up to ~2 MB on heavy threads; timers tick locally anyway.
const RUNNING_REREAD_MS = 2_000;
// why: the events route refuses a larger page.
const EVENT_PAGE = 100;

type Pull = "refresh" | "reload";
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
  private rows: readonly TimelineRow[] = [];
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
      const children = await unlessStopped(signal, this.sdk.threads.list({ parentThreadId: this.threadId, signal }));
      const rows = this.needsRows(reload, events, children) ? await this.readRows(signal) : this.rows;
      const inView = childrenInView(children, rows);
      const readChildren = await this.readChildren(inView, reload ? new Map() : this.childReads, signal);
      this.afterSeq = events.at(-1)?.seq ?? afterSeq;
      this.ledger = foldTaskEvents(reload ? new Map() : this.ledger, events);
      this.rows = rows;
      this.children = children;
      this.childReads = new Map(readChildren.map(({ child, read }) => [child.id, read]));
      this.reloadOwed = false;
      this.failing = false;
      this.watchChildren(inView);
      this.emit({
        status: "ready",
        delegates: [
          ...normalise(rows, this.ledger, providerId),
          ...readChildren.map(({ child, read }) => childDelegate(child, read.rows, rows)),
        ],
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

  /** The one place this thread's rows are read. */
  private async readRows(signal: AbortSignal): Promise<readonly TimelineRow[]> {
    this.lastReads.set(this.threadId, Date.now());
    const timeline = await unlessStopped(
      signal,
      this.sdk.threads.timeline({ threadId: this.threadId, includeNestedRows: "true", segmentLimit: SEGMENT_LIMIT, signal }),
    );
    return timeline.rows;
  }

  /**
   * A child's own rows, with the same segment bound. Nested, because a settled turn comes back
   * collapsed (`children: null`) without it, which would leave a finished child no steps.
   */
  private async readChildRows(threadId: string, signal: AbortSignal): Promise<readonly TimelineRow[]> {
    this.lastReads.set(threadId, Date.now());
    const timeline = await unlessStopped(
      signal,
      this.sdk.threads.timeline({ threadId, includeNestedRows: "true", segmentLimit: SEGMENT_LIMIT, signal }),
    );
    return timeline.rows;
  }

  private emit(next: ThreadDelegates): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

// ---------------------------------------------------------------- helpers (layer 3)

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

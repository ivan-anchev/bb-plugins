// One thread's delegates, kept live from bb: task events are pulled cheaply on
// every change, timeline rows only when a delegate starts or settles, or on a
// throttle while one runs.
import type { EventRow, ThreadChange, ThreadSdk, TimelineRow } from "./bb.ts";
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
  private lastRead = 0;
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
    clearTimeout(this.trailingRead);
    this.trailingRead = undefined;
    this.queued = null;
    this.onIdle(); // why: the next subscriber starts from a clean ledger
  }

  private onThreadChanged(change: ThreadChange): void {
    if (change.changes.includes("history-rewritten") || change.changes.includes("history-compacted")) this.request("reload");
    else if (change.changes.includes("events-appended")) this.request("refresh");
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

  /** Reads into locals, then commits cursor, ledger, and rows together: a failure anywhere changes nothing. */
  private async pull(requested: Pull): Promise<void> {
    const { signal } = this.lifetime;
    const reload = requested === "reload" || this.reloadOwed;
    try {
      this.providerId ??= (await unlessStopped(signal, this.sdk.threads.get({ threadId: this.threadId, signal }))).providerId;
      const afterSeq = reload ? null : this.afterSeq;
      const events = await this.eventsAfter(afterSeq, signal);
      const rows = reload || this.needsTimeline(events) ? await this.readRows(signal) : this.rows;
      this.afterSeq = events.at(-1)?.seq ?? afterSeq;
      this.ledger = foldTaskEvents(reload ? new Map() : this.ledger, events);
      this.rows = rows;
      this.reloadOwed = false;
      this.failing = false;
      this.emit({ status: "ready", providerId: this.providerId, delegates: normalise(this.rows, this.ledger) });
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
   * Heavy: reread rows on a delegate lifecycle event, else at most every 2 s while one runs and the
   * window is visible. A read the throttle skips is owed: one trailing read takes it when the 2 s are up.
   */
  private needsTimeline(events: readonly EventRow[]): boolean {
    if (events.some(isDelegateLifecycle)) return true;
    const running = this.snapshot.status === "ready" && this.snapshot.delegates.some(isRunning);
    if (!running || document.visibilityState !== "visible") return false;
    const wait = this.lastRead + RUNNING_REREAD_MS - Date.now();
    if (wait <= 0) return true;
    this.trailingRead ??= setTimeout(() => {
      this.trailingRead = undefined;
      this.request("refresh");
    }, wait);
    return false;
  }

  /** The one place rows are read. */
  private async readRows(signal: AbortSignal): Promise<readonly TimelineRow[]> {
    this.lastRead = Date.now();
    const timeline = await unlessStopped(
      signal,
      this.sdk.threads.timeline({ threadId: this.threadId, includeNestedRows: "true", segmentLimit: SEGMENT_LIMIT, signal }),
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

/** A new delegate or task starts, or a task completes (its report must be read now). */
function isDelegateLifecycle(event: EventRow): boolean {
  if (event.type === "item/backgroundTask/completed") return true;
  return event.type === "item/started" && (event.data.item.type === "delegation" || event.data.item.type === "backgroundTask");
}

function listen(target: EventTarget, type: string, handler: () => void): () => void {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

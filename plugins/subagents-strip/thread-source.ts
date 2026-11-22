import type { ChildThread, DelegationRow, EventRow, OlderCursor, ThreadChange, ThreadSdk, TimelineRead, TimelineRow } from "./bb.ts";
import { TOKEN_USAGE_EVENT, childDelegate, childrenInView, threadRunning, totalTokensOf, type ChildRead } from "./child-threads.ts";
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

const SEGMENT_LIMIT = "20";
const RUNNING_REREAD_MS = 2_000;
const EVENT_PAGE = 100;

type Pull = "refresh" | "reload";
type Older = { rows: readonly TimelineRow[]; detail: "outline" | "full" };
type VersionedRead = ChildRead & { version: number };
type ReadChild = { child: ChildThread; read: VersionedRead };

class LiveThreadSource implements ThreadSource {
  snapshot: ThreadDelegates = { status: "loading" };
  private readonly sdk: ThreadSdk;
  private readonly threadId: string;
  private readonly onIdle: () => void;
  private readonly listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  private lifetime = new AbortController();
  private providerId: string | null = null;
  private ledger: TaskLedger = new Map();
  private afterSeq: number | null = null;
  private rows: readonly TimelineRow[] = [];
  private liveCursor: OlderCursor = null;
  private older: Older | null = null;
  private historyReaders = 0;
  private historyDemand = new AbortController();
  private children: readonly ChildThread[] = [];
  private childReads: ReadonlyMap<string, VersionedRead> = new Map();
  private readonly childWatches = new Map<string, () => void>();
  private readonly lastReads = new Map<string, number>();
  private trailingRead: ReturnType<typeof setTimeout> | undefined;
  private queued: Pull | null = null;
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

  private stop(): void {
    this.lifetime.abort();
    this.stops.forEach((stop) => stop());
    this.childWatches.forEach((stop) => stop());
    this.childWatches.clear();
    clearTimeout(this.trailingRead);
    this.trailingRead = undefined;
    this.queued = null;
    this.onIdle();
  }

  private onThreadChanged(change: ThreadChange): void {
    if (isRewrite(change)) this.request("reload");
    else if (change.changes.includes("events-appended") || change.changes.includes("status-changed")) this.request("refresh");
  }

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

  private async pull(requested: Pull): Promise<void> {
    const { signal } = this.lifetime;
    const reload = requested === "reload" || this.reloadOwed;
    try {
      const providerId = (this.providerId ??= (await unlessStopped(signal, this.sdk.threads.get({ threadId: this.threadId, signal }))).providerId);
      const afterSeq = reload ? null : this.afterSeq;
      const events = await this.eventsAfter(afterSeq, signal);
      const children = await unlessStopped(signal, this.sdk.threads.list({ parentThreadId: this.threadId, archived: false, signal }));
      const heldOlder = reload ? null : this.older;
      const walk = olderWalk(heldOlder, this.historyReaders > 0);
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
        delegates: [...delegations, ...readChildren.map(({ child, read }) => childDelegate(child, read, allRows))],
        turns: turnsOf(allRows),
        outlined: older?.detail === "outline" ? outlinedOf(delegations, normalise(rows, this.ledger, providerId)) : NONE,
      });
    } catch (error) {
      if (signal.aborted) return;
      if (!this.failing) console.error("[subagents-strip]", error);
      this.failing = true;
      this.reloadOwed = reload;
      if (this.snapshot.status !== "ready") this.emit({ status: "failed", message: String(error) });
    }
  }

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

  private needsRows(reload: boolean, events: readonly EventRow[], children: readonly ChildThread[]): boolean {
    if (reload || events.some(isDelegateLifecycle)) return true;
    if (children.some((child) => !this.children.some((known) => known.id === child.id))) return true;
    return this.delegationRunning() && this.rereadDue(this.threadId);
  }

  private async readChildren(
    inView: readonly ChildThread[],
    cache: ReadonlyMap<string, VersionedRead>,
    signal: AbortSignal,
  ): Promise<ReadChild[]> {
    return Promise.all(
      inView.map(async (child): Promise<ReadChild> => {
        const cached = cache.get(child.id);
        const current = cached?.version === child.updatedAt ? cached : undefined;
        if (current && !(threadRunning(child) && this.rereadDue(child.id))) return { child, read: current };
        const [rows, totalTokens] = await Promise.all([
          this.readChildRows(child.id, signal),
          current ? current.totalTokens : this.readChildTokens(child.id, signal),
        ]);
        return { child, read: { version: child.updatedAt, rows, totalTokens } };
      }),
    );
  }

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

  private delegationRunning(): boolean {
    return this.snapshot.status === "ready" && this.snapshot.delegates.some((d) => d.origin.kind === "delegation" && isRunning(d));
  }

  private async readRows(signal: AbortSignal): Promise<TimelineRead> {
    this.lastReads.set(this.threadId, Date.now());
    return this.readWindow({}, signal);
  }

  private async walkOlder(cursor: OlderCursor, detail: Older["detail"], held: Older | null, lifetime: AbortSignal): Promise<Older | null> {
    if (detail === "outline") return { rows: await this.readOlder(cursor, detail, lifetime), detail };
    const demand = this.historyDemand.signal;
    try {
      return { rows: await this.readOlder(cursor, detail, AbortSignal.any([lifetime, demand])), detail };
    } catch (error) {
      if (!demand.aborted || lifetime.aborted) throw error;
      return held ? null : this.walkOlder(cursor, "outline", held, lifetime);
    }
  }

  private async readOlder(cursor: OlderCursor, detail: Older["detail"], signal: AbortSignal): Promise<readonly TimelineRow[]> {
    if (cursor === null) return [];
    const deferContent = detail === "outline" ? { deferContent: "true" as const } : {};
    const start = detail === "outline" ? (await this.readWindow(deferContent, signal)).timelinePage.olderCursor : cursor;
    let rows: readonly TimelineRow[] = [];
    for (let next = start; next !== null; ) {
      const page = await this.readWindow({ ...deferContent, beforeAnchorId: next.anchorId, beforeAnchorSeq: String(next.anchorSeq) }, signal);
      rows = joinRows(page.rows, rows);
      next = page.timelinePage.olderCursor;
    }
    return rows;
  }

  private readWindow(
    query: Pick<Parameters<ThreadSdk["threads"]["timeline"]>[0], "deferContent" | "beforeAnchorId" | "beforeAnchorSeq">,
    signal: AbortSignal,
  ): Promise<TimelineRead> {
    return unlessStopped(signal, this.sdk.threads.timeline({ threadId: this.threadId, includeNestedRows: "true", segmentLimit: SEGMENT_LIMIT, ...query, signal }));
  }

  private async readChildRows(threadId: string, signal: AbortSignal): Promise<readonly TimelineRow[]> {
    this.lastReads.set(threadId, Date.now());
    const timeline = await unlessStopped(
      signal,
      this.sdk.threads.timeline({ threadId, includeNestedRows: "true", deferContent: "true", segmentLimit: SEGMENT_LIMIT, signal }),
    );
    return timeline.rows;
  }

  private async readChildTokens(threadId: string, signal: AbortSignal): Promise<number | null> {
    const [latest] = await unlessStopped(
      signal,
      this.sdk.threads.events.list({ threadId, types: [TOKEN_USAGE_EVENT], order: "desc", limit: "1", signal }),
    );
    return totalTokensOf(latest);
  }

  private emit(next: ThreadDelegates): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

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

function mergeRow(older: TimelineRow, newer: TimelineRow): TimelineRow {
  if (older.kind === "turn" && newer.kind === "turn") return { ...newer, children: joinNested(older.children, newer.children) };
  if (isDelegationRow(older) && isDelegationRow(newer)) return { ...newer, childRows: joinNested(older.childRows, newer.childRows) };
  return newer;
}

function joinNested(older: TimelineRow[] | null, newer: TimelineRow[] | null): TimelineRow[] | null {
  if (older === null) return newer;
  if (newer === null) return older;
  return [...joinRows(older, newer)];
}

const isDelegationRow = (row: TimelineRow): row is DelegationRow => row.kind === "work" && row.workKind === "delegation";

function olderWalk(held: Older | null, fullWanted: boolean): Older["detail"] | null {
  if (fullWanted && held?.detail !== "full") return "full";
  return held === null ? "outline" : null;
}

function keepOlder(older: Older | null, previous: readonly TimelineRow[], live: TimelineRead | null): Older | null {
  if (older === null || live === null) return older;
  const { olderCursor } = live.timelinePage;
  if (olderCursor === null) return { rows: [], detail: older.detail };
  const start = olderCursor.anchorSeq;
  const slid = joinRows(older.rows, previous.filter((row) => row.sourceSeqEnd < start));
  return { rows: joinRows(slid, live.timelinePage.olderRowUpdates ?? []), detail: older.detail };
}

function outlinedOf(all: readonly Delegate[], live: readonly Delegate[]): ReadonlySet<DelegateId> {
  const read = new Set(live.map((d) => d.id));
  return new Set(all.flatMap((d) => (read.has(d.id) ? [] : [d.id])));
}

const NONE: ReadonlySet<DelegateId> = new Set();

async function unlessStopped<T>(signal: AbortSignal, read: Promise<T>): Promise<T> {
  const result = await read;
  signal.throwIfAborted();
  return result;
}

function isRewrite(change: ThreadChange): boolean {
  return change.changes.includes("history-rewritten") || change.changes.includes("history-compacted");
}

function isDelegateLifecycle(event: EventRow): boolean {
  if (event.type === "item/backgroundTask/completed") return true;
  return event.type === "item/started" && (event.data.item.type === "delegation" || event.data.item.type === "backgroundTask");
}

function listen(target: EventTarget, type: string, handler: () => void): () => void {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

// Each open regional manager's line: the first sentence of its own latest reply with text, read from
// its thread's completed items. A manager's first read looks back from its newest item to that reply;
// after that, each time its thread moves, only the items since are read, and a rewritten history is
// read afresh. A changed line marks every client's read stale. A user's message, a tool call or result,
// a reply without text, and a subagent's reply are never the manager's line.
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MANAGER_LINES_TAG } from "../../contract.ts";
import { firstSentence, type ManagerLine } from "../../model/manager-line.ts";
import { REGIONAL_MANAGER } from "../../model/manager-look.ts";

/** How many completed items one read of a thread's events asks for. */
const PAGE = 50;

/** After a failed read, how long until each read again, in turn; past the last, the next move of the thread or client read tries again. */
const RETRY_MS = [2_000, 5_000, 15_000];

type Deps = {
  threads: {
    list(args: OpenManagersOf): Promise<readonly { id: string }[]>;
    events: { list(args: CompletedItems): Promise<readonly EventRow[]> };
  };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

/** bb's thread list narrowed to the open (existing, unarchived) regional managers among `threadIds`. */
type OpenManagersOf = { threadIds: readonly string[]; originPluginId: typeof REGIONAL_MANAGER; hasParent: false; archived: false; signal: AbortSignal };

/** A thread's completed items, newest first back from `beforeSeq`, or oldest first on from `afterSeq`. */
type CompletedItems = Pick<Parameters<PluginBbSdk["threads"]["events"]["list"]>[0], "afterSeq" | "beforeSeq" | "order"> & {
  threadId: string;
  types: ["item/completed"];
  limit: string;
  signal: AbortSignal;
};

/** As much of an event row as a line needs. */
type EventRow = { seq: number; type: string; data: unknown };

/**
 * What a manager's line was read from: the newest completed item read (0 for none: the next read looks
 * back from the newest), its line (null for none), and whether the last read failed, so the next
 * client read tries again.
 */
type Latest = { seq: number; line: string | null; failed: boolean };

/** A manager never read, or one whose history was rewritten: its next read looks back from the newest item. */
const UNREAD: Latest = { seq: 0, line: null, failed: false };

/** What `thread:changed` says of a thread: which, and what about it changed. */
type ThreadChange = { id?: string; changes: readonly string[] };

export type ManagerLines = ReturnType<typeof openManagerLines>;

export function openManagerLines({ threads, rpc, log }: Deps) {
  const life = new AbortController();
  /** Each manager read so far, by thread: its latest, read one step at a time, each chained on the last (`step`). */
  const known = new Map<string, Promise<Latest>>();
  /** The managers whose last read failed: the read again set for each, and how many it has had. */
  const retries = new Map<string, { timer: ReturnType<typeof setTimeout>; tries: number }>();

  return {
    /** The line of each open manager among `threadIds`; one never read is read now, and one whose last read failed is read again. */
    async read({ threadIds }: { threadIds: readonly string[] }): Promise<{ lines: ManagerLine[] }> {
      const open = await openManagers(threadIds);
      for (const id of threadIds) if (!open.includes(id)) known.delete(id);
      const latest = await Promise.all(open.map(current));
      return { lines: open.flatMap((threadId, at) => lineOf(threadId, latest[at])) };
    },

    /** A thread's events moved: a manager a client reads reads its items since. */
    moved({ id }: { id: string }): void {
      if (known.has(id)) step(id, readOn);
    },

    /** A thread's history rewritten or compacted: a manager a client reads is read afresh, its old line dropped. */
    changed({ id, changes }: ThreadChange): void {
      if (id === undefined || !known.has(id) || !changes.some((change) => change === "history-rewritten" || change === "history-compacted")) return;
      step(id, (threadId) => readOn(threadId, UNREAD));
    },

    /** The plugin unloading: a read under way is abandoned. */
    dispose(): void {
      life.abort();
      for (const { timer } of retries.values()) clearTimeout(timer);
      retries.clear();
    },
  };

  /**
   * One read of a manager's line, chained after any read of it under way, so reads of one manager never
   * overlap and each starts from where the last ended. A line changed since an earlier read refreshes
   * every client; a first read is only the asking client's.
   */
  function step(threadId: string, read: (threadId: string, latest: Latest) => Promise<Latest>): Promise<Latest> {
    const was = known.get(threadId);
    const next = (was ?? Promise.resolve(UNREAD)).then((latest) => read(threadId, latest));
    known.set(threadId, next);
    if (was !== undefined) void announce(was, next);
    void next.then((latest) => (latest.failed ? retryLater(threadId) : retried(threadId)));
    return next;
  }

  /** A failed read is read again by itself, RETRY_MS apart, until one succeeds or the tries run out. */
  function retryLater(threadId: string): void {
    const pending = retries.get(threadId);
    if (pending !== undefined) clearTimeout(pending.timer);
    const tries = pending?.tries ?? 0;
    if (tries === RETRY_MS.length || life.signal.aborted) {
      retries.delete(threadId);
      return;
    }
    const timer = setTimeout(() => {
      if (known.has(threadId)) void step(threadId, readOn);
    }, RETRY_MS[tries]);
    retries.set(threadId, { timer, tries: tries + 1 });
  }

  /** A read succeeded: any read again set for it is no longer needed. */
  function retried(threadId: string): void {
    const retry = retries.get(threadId);
    if (retry === undefined) return;
    clearTimeout(retry.timer);
    retries.delete(threadId);
  }

  async function announce(was: Promise<Latest>, next: Promise<Latest>): Promise<void> {
    const [before, after] = await Promise.all([was, next]);
    if (after.line !== before.line && !life.signal.aborted) rpc.experimental_invalidate([MANAGER_LINES_TAG]);
  }

  /** A manager's latest for a client: read now if never read, read again if its last read failed. */
  function current(threadId: string): Promise<Latest> {
    const pending = known.get(threadId);
    if (pending === undefined) return step(threadId, readOn);
    return pending.then((latest) => (latest.failed ? step(threadId, readOn) : latest));
  }

  async function openManagers(threadIds: readonly string[]): Promise<string[]> {
    if (threadIds.length === 0) return [];
    const open = await threads.list({ threadIds, originPluginId: REGIONAL_MANAGER, hasParent: false, archived: false, signal: life.signal });
    return open.map(({ id }) => id);
  }

  /**
   * The items since `latest` was read, a page at a time: the line changes only when a newer reply came.
   * With nothing read before, back from the newest. A failure keeps what was read, marked for a retry.
   */
  async function readOn(threadId: string, latest: Latest): Promise<Latest> {
    try {
      if (latest.seq === 0) return await readBack(threadId);
      let at: Latest = { ...latest, failed: false };
      for (;;) {
        const rows = await completed(threadId, { order: "asc", afterSeq: String(at.seq) });
        if (rows.length === 0) return at;
        at = { seq: rows[rows.length - 1].seq, line: latestLine([...rows].reverse()) ?? at.line, failed: false };
        if (rows.length < PAGE) return at;
      }
    } catch (error) {
      if (!life.signal.aborted) log.warn(`Couldn't read regional manager ${threadId}'s replies; the next read tries again: ${error instanceof Error ? error.message : String(error)}`);
      return { ...latest, failed: true };
    }
  }

  /** Back from the newest completed item to the latest reply, a page at a time, as far as the thread goes. */
  async function readBack(threadId: string): Promise<Latest> {
    let newest = 0;
    let beforeSeq: string | undefined;
    for (;;) {
      const rows = await completed(threadId, { order: "desc", beforeSeq });
      if (rows.length === 0) return { seq: newest, line: null, failed: false };
      newest ||= rows[0].seq;
      const line = latestLine(rows);
      if (line !== null) return { seq: newest, line, failed: false };
      beforeSeq = String(rows[rows.length - 1].seq);
    }
  }

  function completed(threadId: string, from: Pick<CompletedItems, "order" | "afterSeq" | "beforeSeq">): Promise<readonly EventRow[]> {
    return threads.events.list({ threadId, types: ["item/completed"], limit: String(PAGE), signal: life.signal, ...from });
  }
}

// ------------------------------------------------------------------ layer 2

/** A reply the manager itself completed: its own agent message, not a subagent's (which hangs under a tool call). */
const ownReplySchema = z.object({
  type: z.literal("item/completed"),
  data: z.object({ item: z.object({ type: z.literal("agentMessage"), text: z.string(), parentToolCallId: z.undefined().optional() }) }),
});

/** The line of the first of `rows` (newest first) that is the manager's own reply with words, or null for none. */
function latestLine(rows: readonly EventRow[]): string | null {
  for (const row of rows) {
    const reply = ownReplySchema.safeParse(row);
    const line = reply.success ? firstSentence(reply.data.data.item.text) : null;
    if (line !== null) return line;
  }
  return null;
}

const lineOf = (threadId: string, { line }: Latest): ManagerLine[] => (line === null ? [] : [{ threadId, line }]);

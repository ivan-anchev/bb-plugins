// Each open regional manager's line: the first sentence of its own latest reply with text, read from
// its thread's completed items. A manager's first read looks back from its newest item; after that, each
// time its thread moves, only the items since are read, and a changed line marks every client's read
// stale. A user's message, a tool call or result, a reply without text, and a subagent's reply are never
// the manager's line.
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MANAGER_LINES_TAG } from "../../contract.ts";
import { isManagerThread, REGIONAL_MANAGER } from "../../model/manager-look.ts";
import { firstSentence, type ManagerLine } from "../../model/manager-line.ts";

/** How many completed items one read of a thread's events asks for. */
const PAGE = 50;
/** How far a manager's first read looks back for a reply before it settles for none: this many pages. */
const PAGES_BACK = 4;

type Deps = {
  threads: {
    list(args: OpenManagers): Promise<readonly { id: string }[]>;
    events: { list(args: CompletedItems): Promise<readonly EventRow[]> };
  };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

/** bb's thread list narrowed to the open (existing, unarchived) regional managers. */
type OpenManagers = { originPluginId: typeof REGIONAL_MANAGER; hasParent: false; archived: false; signal: AbortSignal };

/** A thread's completed items, newest first back from `beforeSeq`, or oldest first on from `afterSeq`. */
type CompletedItems = Pick<Parameters<PluginBbSdk["threads"]["events"]["list"]>[0], "afterSeq" | "beforeSeq" | "order"> & {
  threadId: string;
  types: ["item/completed"];
  limit: string;
  signal: AbortSignal;
};

/** As much of an event row as a line needs. */
type EventRow = { seq: number; type: string; data: unknown };

/** What a manager's line was read from: its newest completed item read (0 for none), and its line, null for none. */
type Latest = { seq: number; line: string | null };

/** What `experimental_thread.events` says: a thread whose events moved. */
type ThreadMoved = { id: string; originPluginId: string | null; parentThreadId: string | null };

export type ManagerLines = ReturnType<typeof openManagerLines>;

export function openManagerLines({ threads, rpc, log }: Deps) {
  const life = new AbortController();
  /** Each manager read so far, by thread: its latest, one read at a time (each chained on the last). */
  const known = new Map<string, Promise<Latest>>();

  return {
    /** Every open manager's line; one whose events can't be read shows none until the next read. */
    async read(): Promise<{ lines: ManagerLine[] }> {
      const open = await openManagerIds();
      for (const id of known.keys()) if (!open.includes(id)) known.delete(id);
      const latest = await Promise.all(open.map((threadId) => known.get(threadId) ?? firstRead(threadId)));
      return { lines: open.flatMap((threadId, at) => lineOf(threadId, latest[at])) };
    },

    /** A thread's events moved: a manager's already read reads its items since, and a changed line refreshes every client. */
    moved(thread: ThreadMoved): void {
      const was = known.get(thread.id);
      if (was === undefined || !isManagerThread(thread)) return;
      const next = was.then((latest) => readOn(thread.id, latest));
      known.set(thread.id, next);
      void Promise.all([was, next]).then(([before, after]) => {
        if (after.line !== before.line && !life.signal.aborted) rpc.experimental_invalidate([MANAGER_LINES_TAG]);
      });
    },

    /** The plugin unloading: a read under way is abandoned. */
    dispose(): void {
      life.abort();
    },
  };

  async function openManagerIds(): Promise<string[]> {
    const open = await threads.list({ originPluginId: REGIONAL_MANAGER, hasParent: false, archived: false, signal: life.signal });
    return open.map(({ id }) => id);
  }

  /** A manager's first read; one that fails is forgotten, so the next read tries again. */
  function firstRead(threadId: string): Promise<Latest> {
    const read = readBack(threadId).catch((error: unknown): Latest => {
      if (known.get(threadId) === read) known.delete(threadId);
      warn(`Couldn't read regional manager ${threadId}'s latest reply; its row shows its name alone for now`, error);
      return { seq: 0, line: null };
    });
    known.set(threadId, read);
    return read;
  }

  /** Back from the newest completed item to the latest reply, a page at a time, at most PAGES_BACK of them. */
  async function readBack(threadId: string): Promise<Latest> {
    let newest = 0;
    let beforeSeq: string | undefined;
    for (let page = 0; page < PAGES_BACK; page++) {
      const rows = await completed(threadId, { order: "desc", beforeSeq });
      if (rows.length === 0) break;
      newest ||= rows[0].seq;
      const line = latestLine(rows);
      if (line !== null) return { seq: newest, line };
      beforeSeq = String(rows[rows.length - 1].seq);
    }
    return { seq: newest, line: null };
  }

  /**
   * The items since `latest` was read, a page at a time; the line stays as it was unless a newer reply
   * came. With nothing read before (no items yet, or the first read failed), back from the newest. A
   * failure keeps it as it was.
   */
  async function readOn(threadId: string, latest: Latest): Promise<Latest> {
    try {
      if (latest.seq === 0) return await readBack(threadId);
      let at = latest;
      for (;;) {
        const rows = await completed(threadId, { order: "asc", afterSeq: String(at.seq) });
        if (rows.length === 0) return at;
        at = { seq: rows[rows.length - 1].seq, line: latestLine([...rows].reverse()) ?? at.line };
        if (rows.length < PAGE) return at;
      }
    } catch (error) {
      warn(`Couldn't read regional manager ${threadId}'s new replies; its line is read again when its thread next moves`, error);
      return latest;
    }
  }

  function completed(threadId: string, from: Pick<CompletedItems, "order" | "afterSeq" | "beforeSeq">): Promise<readonly EventRow[]> {
    return threads.events.list({ threadId, types: ["item/completed"], limit: String(PAGE), signal: life.signal, ...from });
  }

  function warn(what: string, error: unknown): void {
    if (!life.signal.aborted) log.warn(`${what}: ${error instanceof Error ? error.message : String(error)}`);
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

// The regional managers' looks (their avatars), read from the Regional Manager plugin's
// published `coordinators` on every read, and when to read them again. That read is one-shot: the
// plugin's own invalidations never reach this one, so a manager's thread created, renamed or archived
// marks it stale, and so does every minute (an avatar edit renames nothing).
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { MANAGER_LOOKS_TAG } from "../../contract.ts";
import { coordinatorsReadSchema, isManagerThread, REGIONAL_MANAGER, type ManagerLook } from "../../model/manager-look.ts";

/** The events besides creation that can add or remove a manager; server.ts hands each to `changed`. */
export const MANAGER_EVENTS = ["thread.archived", "thread.unarchived", "thread.deleted"] as const;

/**
 * A new manager's thread exists before the Regional Manager plugin binds its profile to it, so the read
 * its creation brings can miss it: read again this long after, at most this many times, until it shows.
 */
const BIND_RETRY_MS = 2_000;
const BIND_RETRIES = 2;

/** bb's thread list takes at most this many thread ids a call. */
const IDS_PER_LIST = 200;

type Deps = {
  plugins: Pick<PluginBbSdk["plugins"], "callRpc">;
  threads: {
    get(args: { threadId: string; signal: AbortSignal }): Promise<ManagerTest>;
    list(args: OpenManagersOf): Promise<readonly { id: string }[]>;
  };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

/** What tells a manager's thread from any other (model/manager-look.ts `isManagerThread`). */
type ManagerTest = { originPluginId: string | null; parentThreadId: string | null };

/** bb's thread list narrowed to the open (existing, unarchived) managers among `threadIds`. */
type OpenManagersOf = { threadIds: string[]; originPluginId: typeof REGIONAL_MANAGER; hasParent: false; archived: false; signal: AbortSignal };

/** What `thread:changed` says of a thread: which, and what about it changed. */
type ThreadChange = { id?: string; changes: readonly string[] };

export type ManagerLooks = ReturnType<typeof openManagerLooks>;

export function openManagerLooks({ plugins, threads, rpc, log }: Deps) {
  const life = new AbortController();
  const stale = () => rpc.experimental_invalidate([MANAGER_LOOKS_TAG]);
  const changed = (thread: ManagerTest) => {
    if (isManagerThread(thread)) stale();
  };
  const binding = bindWatch(stale, life.signal);

  return {
    /**
     * Every open manager's look; none when the plugin is missing, fails, or answers in a shape this
     * copy of its schema doesn't know. A manager without a look shows its name and a plain avatar.
     */
    async read(): Promise<{ looks: ManagerLook[] }> {
      const looks = await readLooks();
      binding.seen(looks);
      return { looks };
    },

    /** A manager's thread created: every client reads again, and again shortly while its look is missing. */
    created(thread: ManagerTest & { id: string }): void {
      if (!isManagerThread(thread)) return;
      binding.expect(thread.id);
      stale();
    },

    /** A thread archived, unarchived or deleted: a manager's makes every client read again. */
    changed,

    /**
     * A thread retitled: a manager's (its profile edited, perhaps with its avatar) makes every
     * client read again. Which thread it is comes from bb, so a manager the last read missed counts too.
     */
    async threadChanged({ id, changes }: ThreadChange): Promise<void> {
      if (id === undefined || !changes.includes("title-changed")) return;
      try {
        const thread = await threads.get({ threadId: id, signal: life.signal });
        if (!life.signal.aborted) changed(thread);
      } catch (error) {
        if (!life.signal.aborted) log.warn(`Couldn't read retitled thread ${id}; its look, if a manager's, is read again within a minute: ${messageOf(error)}`);
      }
    },

    /** Every client reads again: the timer's, for an edit nothing announces. */
    stale,

    /** The plugin unloading: a lookup under way is abandoned, and nothing is read again. */
    dispose(): void {
      life.abort();
    },
  };

  /** The open managers' looks: the Regional Manager plugin keeps archived and deleted ones' too, which no client shows. */
  async function readLooks(): Promise<ManagerLook[]> {
    const { signal } = life;
    try {
      const { coordinators } = await plugins.callRpc({ pluginId: REGIONAL_MANAGER, method: "coordinators", input: {}, outputSchema: coordinatorsReadSchema, signal });
      const open = await openThreadIds(coordinators.map((look) => look.threadId));
      return coordinators.filter((look) => open.has(look.threadId));
    } catch (error) {
      if (!signal.aborted) log.warn(`Couldn't read the regional managers' avatars; they show plain ones: ${messageOf(error)}`);
      return [];
    }
  }

  async function openThreadIds(ids: readonly string[]): Promise<Set<string>> {
    const open = new Set<string>();
    for (let at = 0; at < ids.length; at += IDS_PER_LIST) {
      const page = await threads.list({ threadIds: ids.slice(at, at + IDS_PER_LIST), originPluginId: REGIONAL_MANAGER, hasParent: false, archived: false, signal: life.signal });
      for (const thread of page) open.add(thread.id);
    }
    return open;
  }
}

// ------------------------------------------------------------------ layer 2

/**
 * The new managers whose look hasn't shown yet, each with the reads again it has left. A read that
 * misses one sets a timer, if none is set; each firing spends one try of every manager still waiting
 * and asks for a read. A look showing, or the plugin unloading, ends the wait.
 */
function bindWatch(stale: () => void, signal: AbortSignal) {
  const waiting = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  signal.addEventListener("abort", () => {
    stop();
    waiting.clear();
  });

  const fire = () => {
    timer = null;
    for (const [threadId, left] of waiting) {
      if (left === 1) waiting.delete(threadId);
      else waiting.set(threadId, left - 1);
    }
    stale();
  };

  return {
    expect(threadId: string): void {
      waiting.set(threadId, BIND_RETRIES);
    },
    seen(looks: readonly ManagerLook[]): void {
      for (const look of looks) waiting.delete(look.threadId);
      if (waiting.size === 0) stop();
      else if (timer === null && !signal.aborted) timer = setTimeout(fire, BIND_RETRY_MS);
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

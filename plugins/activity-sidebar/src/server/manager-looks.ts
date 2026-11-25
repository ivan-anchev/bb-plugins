// The regional managers' looks (avatar and description), read from the Regional Manager plugin's
// published `coordinators` on every read, and when to read them again. That read is one-shot: the
// plugin's own invalidations never reach this one, so a manager's thread created, renamed or archived
// marks it stale, and so does every minute (an avatar or description edit renames nothing).
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { MANAGER_LOOKS_TAG } from "../contract.ts";
import { coordinatorsReadSchema, isManagerThread, REGIONAL_MANAGER, type ManagerLook } from "../model/manager-look.ts";

/** The events besides creation that can add or remove a manager; server.ts hands each to `changed`. */
export const MANAGER_EVENTS = ["thread.archived", "thread.unarchived", "thread.deleted"] as const;

/**
 * A new manager's thread exists before the Regional Manager plugin binds its profile to it, so the read
 * its creation brings can miss it: read again this long after, at most this many times, until it shows.
 */
export const BIND_RETRY_MS = 2_000;
const BIND_RETRIES = 2;

type Deps = {
  plugins: Pick<PluginBbSdk["plugins"], "callRpc">;
  threads: { get(args: { threadId: string; signal: AbortSignal }): Promise<ManagerTest> };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

/** What tells a manager's thread from any other (model/manager-look.ts `isManagerThread`). */
type ManagerTest = { originPluginId: string | null; parentThreadId: string | null };

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
     * Every started manager's look; none when the plugin is missing, fails, or answers in a shape this
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
     * A thread retitled: a manager's (its profile edited, perhaps with its description) makes every
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

  async function readLooks(): Promise<ManagerLook[]> {
    try {
      return (await plugins.callRpc({ pluginId: REGIONAL_MANAGER, method: "coordinators", input: {}, outputSchema: coordinatorsReadSchema })).coordinators;
    } catch (error) {
      log.warn(`Couldn't read the regional managers' avatars and descriptions; they show with their names only: ${messageOf(error)}`);
      return [];
    }
  }
}

// ------------------------------------------------------------------ layer 2

/**
 * The new managers whose look hasn't shown yet, each with the reads again it has left. After each read,
 * one still missing asks for another BIND_RETRY_MS later, until it shows or its tries run out.
 */
function bindWatch(stale: () => void, signal: AbortSignal) {
  const waiting = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  signal.addEventListener("abort", () => {
    if (timer !== null) clearTimeout(timer);
    waiting.clear();
  });

  return {
    expect(threadId: string): void {
      waiting.set(threadId, BIND_RETRIES);
    },
    seen(looks: readonly ManagerLook[]): void {
      for (const [threadId, left] of waiting) {
        if (left === 0 || looks.some((look) => look.threadId === threadId)) waiting.delete(threadId);
        else waiting.set(threadId, left - 1);
      }
      if (waiting.size === 0 || timer !== null || signal.aborted) return;
      timer = setTimeout(() => {
        timer = null;
        stale();
      }, BIND_RETRY_MS);
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

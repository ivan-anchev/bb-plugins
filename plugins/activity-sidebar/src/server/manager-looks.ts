// The regional managers' looks (avatar and description), read from the Regional Manager plugin's
// published `coordinators` on every read, and when to read them again. That read is one-shot: the
// plugin's own invalidations never reach this one, so a manager's thread created, renamed or archived
// marks it stale, and so does every minute (an avatar or description edit renames nothing).
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { MANAGER_LOOKS_TAG } from "../contract.ts";
import { coordinatorsReadSchema, isManagerThread, REGIONAL_MANAGER, type ManagerLook } from "../model/manager-look.ts";

/** The events that can add or remove a manager; server.ts hands each to `changed`. */
export const MANAGER_EVENTS = ["thread.created", "thread.archived", "thread.unarchived", "thread.deleted"] as const;

type Deps = {
  plugins: Pick<PluginBbSdk["plugins"], "callRpc">;
  threads: { get(args: { threadId: string }): Promise<ManagerTest> };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

/** What tells a manager's thread from any other (model/manager-look.ts `isManagerThread`). */
type ManagerTest = { originPluginId: string | null; parentThreadId: string | null };

/** What `thread:changed` says of a thread: which, and what about it changed. */
type ThreadChange = { id?: string; changes: readonly string[] };

export type ManagerLooks = ReturnType<typeof openManagerLooks>;

export function openManagerLooks({ plugins, threads, rpc, log }: Deps) {
  const stale = () => rpc.experimental_invalidate([MANAGER_LOOKS_TAG]);
  const changed = (thread: ManagerTest) => {
    if (isManagerThread(thread)) stale();
  };

  return {
    /**
     * Every started manager's look; none when the plugin is missing, fails, or answers in a shape this
     * copy of its schema doesn't know. A manager without a look shows its name and a plain avatar.
     */
    async read(): Promise<{ looks: ManagerLook[] }> {
      try {
        const { coordinators } = await plugins.callRpc({ pluginId: REGIONAL_MANAGER, method: "coordinators", input: {}, outputSchema: coordinatorsReadSchema });
        return { looks: coordinators };
      } catch (error) {
        log.warn(`Couldn't read the regional managers' avatars and descriptions; they show with their names only: ${messageOf(error)}`);
        return { looks: [] };
      }
    },

    /** A thread created, archived, unarchived or deleted: a manager's makes every client read again. */
    changed,

    /**
     * A thread retitled: a manager's (its profile edited, perhaps with its description) makes every
     * client read again. Which thread it is comes from bb, so a manager the last read missed counts too.
     */
    async threadChanged({ id, changes }: ThreadChange): Promise<void> {
      if (id === undefined || !changes.includes("title-changed")) return;
      try {
        changed(await threads.get({ threadId: id }));
      } catch (error) {
        log.warn(`Couldn't read retitled thread ${id}; its look, if a manager's, is read again within a minute: ${messageOf(error)}`);
      }
    },

    /** Every client reads again: the timer's, for an edit nothing announces. */
    stale,
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

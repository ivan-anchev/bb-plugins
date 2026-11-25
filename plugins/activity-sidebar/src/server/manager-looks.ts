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
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

export type ManagerLooks = ReturnType<typeof openManagerLooks>;

export function openManagerLooks({ plugins, rpc, log }: Deps) {
  /** The managers' threads as last read, whose renames mark the looks stale. */
  let read = new Set<string>();
  const stale = () => rpc.experimental_invalidate([MANAGER_LOOKS_TAG]);

  return {
    /**
     * Every started manager's look. None when the plugin is missing, fails, or answers in a shape this
     * copy of its schema doesn't know: each manager then shows with its name and a plain avatar.
     */
    async read(): Promise<{ looks: ManagerLook[] }> {
      try {
        const { coordinators } = await plugins.callRpc({ pluginId: REGIONAL_MANAGER, method: "coordinators", input: {}, outputSchema: coordinatorsReadSchema });
        read = new Set(coordinators.map(({ threadId }) => threadId));
        return { looks: coordinators };
      } catch (error) {
        log.warn(`Couldn't read the regional managers' avatars and descriptions; they show with their names only: ${error instanceof Error ? error.message : String(error)}`);
        return { looks: [] };
      }
    },

    /** A thread created, archived, unarchived or deleted: a manager's makes every client read again. */
    changed(thread: { originPluginId: string | null; parentThreadId: string | null }): void {
      if (isManagerThread(thread)) stale();
    },

    /** A thread retitled: a manager's (its profile edited, perhaps with its description) makes every client read again. */
    retitled(threadId: string): void {
      if (read.has(threadId)) stale();
    },

    /** Every client reads again: the timer's, for an edit nothing announces. */
    stale,
  };
}

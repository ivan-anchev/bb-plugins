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

/** What `thread:changed` says of a thread: which, and what about it changed. */
type ThreadChange = { id?: string; changes: readonly string[] };

export type ManagerLooks = ReturnType<typeof openManagerLooks>;

export function openManagerLooks({ plugins, rpc, log }: Deps) {
  /** The looks as last read; also which threads are managers, whose renames mark them stale. */
  let last: ManagerLook[] = [];
  const stale = () => rpc.experimental_invalidate([MANAGER_LOOKS_TAG]);

  return {
    /**
     * Every started manager's look. When the plugin is missing, fails, or answers in a shape this copy
     * of its schema doesn't know, the looks last read (none at first): a manager without one shows
     * with its name and a plain avatar, and one failed read never blanks the avatars already shown.
     */
    async read(): Promise<{ looks: ManagerLook[] }> {
      try {
        const { coordinators } = await plugins.callRpc({ pluginId: REGIONAL_MANAGER, method: "coordinators", input: {}, outputSchema: coordinatorsReadSchema });
        last = coordinators;
      } catch (error) {
        log.warn(`Couldn't read the regional managers' avatars and descriptions; showing the last ones read: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { looks: last };
    },

    /** A thread created, archived, unarchived or deleted: a manager's makes every client read again. */
    changed(thread: { originPluginId: string | null; parentThreadId: string | null }): void {
      if (isManagerThread(thread)) stale();
    },

    /** A manager's thread retitled (its profile edited, perhaps with its description) makes every client read again. */
    threadChanged({ id, changes }: ThreadChange): void {
      if (changes.includes("title-changed") && last.some(({ threadId }) => threadId === id)) stale();
    },

    /** Every client reads again: the timer's, for an edit nothing announces. */
    stale,
  };
}

// The regional managers' open work for their cards, read from the Regional Manager plugin's published
// `openIssues`, and when to read it again. That read is one-shot: the plugin's own invalidations never
// reach this one. So a thread of that plugin's (a manager's, or one of its agents', reviewers' or
// verifiers') starting, changing status, asking, being answered, or leaving or coming back marks every
// card's read stale, and so does every minute (a merged pull request: nothing here announces it). Only
// a card open reads again.
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { MANAGER_ISSUES_TAG } from "../../contract.ts";
import { openIssuesReadSchema, type ManagerIssues } from "../../model/manager-issues.ts";
import { REGIONAL_MANAGER } from "../../model/manager-look.ts";

/** What can change a manager's open work as bb sees it: a thread starting, changing status, asking, leaving, coming back. server.ts hands each to `changed`. */
export const ISSUE_EVENTS = ["thread.created", "thread.active", "thread.idle", "thread.failed", "interaction.pending", "thread.archived", "thread.unarchived", "thread.deleted"] as const;

/** What `thread:changed` says of a thread: which, and what about it changed. */
type ThreadChange = { id?: string; changes: readonly string[] };

type Deps = {
  plugins: Pick<PluginBbSdk["plugins"], "callRpc">;
  threads: { get(args: { threadId: string; signal: AbortSignal }): Promise<{ originPluginId: string | null }> };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

export type ManagerIssuesReader = ReturnType<typeof openManagerIssues>;

export function openManagerIssues({ plugins, threads, rpc, log }: Deps) {
  const life = new AbortController();
  const stale = () => rpc.experimental_invalidate([MANAGER_ISSUES_TAG]);
  const changed = (thread: { originPluginId: string | null }) => {
    if (thread.originPluginId === REGIONAL_MANAGER) stale();
  };

  return {
    /**
     * Each manager's open work, by its id; null for every one when the plugin is missing, fails, or
     * answers in a shape this copy of its schema doesn't know: its card then shows no list.
     */
    async read({ keys }: { keys: readonly string[] }): Promise<Record<string, ManagerIssues | null>> {
      const { signal } = life;
      try {
        const work = await plugins.callRpc({ pluginId: REGIONAL_MANAGER, method: "openIssues", input: { keys: [...keys] }, outputSchema: openIssuesReadSchema, signal });
        return Object.fromEntries(keys.map((key) => [key, work[key] ?? null]));
      } catch (error) {
        if (!signal.aborted) log.warn(`Couldn't read the regional managers' open work; their cards show none: ${messageOf(error)}`);
        return Object.fromEntries(keys.map((key) => [key, null]));
      }
    },

    /** A thread started, changed status, asked, left or came back: one of the Regional Manager plugin's makes every card read again. */
    changed,

    /**
     * A thread's questions or approvals changed: one answered clears its Needs you, though its status
     * may not change, so no status event says it. One of the plugin's makes every card read again.
     * Which thread it is comes from bb.
     */
    async threadChanged({ id, changes }: ThreadChange): Promise<void> {
      if (id === undefined || !changes.includes("interactions-changed")) return;
      try {
        const thread = await threads.get({ threadId: id, signal: life.signal });
        if (!life.signal.aborted) changed(thread);
      } catch (error) {
        if (!life.signal.aborted) log.warn(`Couldn't read thread ${id}, whose questions changed; the cards read again within a minute: ${messageOf(error)}`);
      }
    },

    /** Every card reads again: the timer's, for an edit nothing announces. */
    stale,

    /** The plugin unloading: a read under way is abandoned. */
    dispose(): void {
      life.abort();
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

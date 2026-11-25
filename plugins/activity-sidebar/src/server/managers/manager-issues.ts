// The regional managers' open work for their cards, read from the Regional Manager plugin's published
// `openIssues`, and when to read it again. That read is one-shot: the plugin's own invalidations never
// reach this one, so a thread of its changing status or starting (a manager's, or one of its agents',
// reviewers' or verifiers') marks every card's read stale, and so does every minute (an answered
// decision, a merged pull request: nothing here announces them). Only a card open reads again.
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { MANAGER_ISSUES_TAG } from "../../contract.ts";
import { openIssuesReadSchema, type ManagerIssues } from "../../model/manager-issues.ts";
import { REGIONAL_MANAGER } from "../../model/manager-look.ts";

/** What can change a manager's open work as bb sees it: a thread starting, changing status, asking, leaving. server.ts hands each to `changed`. */
export const ISSUE_EVENTS = ["thread.created", "thread.active", "thread.idle", "thread.failed", "interaction.pending", "thread.archived", "thread.deleted"] as const;

type Deps = {
  plugins: Pick<PluginBbSdk["plugins"], "callRpc">;
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
  log: Pick<BbPluginApi["log"], "warn">;
};

export type ManagerIssuesReader = ReturnType<typeof openManagerIssues>;

export function openManagerIssues({ plugins, rpc, log }: Deps) {
  const life = new AbortController();
  const stale = () => rpc.experimental_invalidate([MANAGER_ISSUES_TAG]);

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

    /** A thread changed status, or started: one of the Regional Manager plugin's makes every card read again. */
    changed(thread: { originPluginId: string | null }): void {
      if (thread.originPluginId === REGIONAL_MANAGER) stale();
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

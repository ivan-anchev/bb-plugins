// Which sidebar rows get the boat icon. Pure, so every case is one unit test.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

type RowThread = Pick<PluginSidebarThread, "id" | "parentThreadId" | "host">;

/**
 * Threads on a boat machine, except a child on its parent's machine: nested under the parent, the
 * parent's icon already says where it runs. A child whose parent bb does not list keeps its icon.
 */
export function boatRowIds(threads: readonly RowThread[], boatHosts: Readonly<Record<string, boolean>>): ReadonlySet<string> {
  const hostOf = new Map(threads.map((thread) => [thread.id, thread.host?.id ?? null]));
  const marked = threads.filter((thread) => {
    if (thread.host === null || boatHosts[thread.host.id] !== true) return false;
    return thread.parentThreadId === null || hostOf.get(thread.parentThreadId) !== thread.host.id;
  });
  return new Set(marked.map((thread) => thread.id));
}

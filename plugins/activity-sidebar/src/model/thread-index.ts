// Who hangs under whom, from the live array the sidebar hook already holds: no request.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { baseState, UNDER_WAY } from "./state.ts";

export type ThreadIndex = {
  /** The pill: the thread's own background agents plus every running thread below it. */
  runningUnder(id: string): number;
  /** The parentless ancestor of `id`, or `id` itself; null for an id the index doesn't hold. */
  rootOf(id: string): string | null;
};

/** Built once per hook update. Hidden and archived threads are left out, as bb's own list does. */
export function indexThreads(threads: readonly PluginSidebarThread[]): ThreadIndex {
  const live = threads.filter((t) => !t.isHidden && !t.isArchived);
  const byId = new Map(live.map((t) => [t.id, t]));
  const children = childrenByParent(live);

  // Every visible, active thread below `id`, children first.
  const below = (id: string): PluginSidebarThread[] => (children.get(id) ?? []).flatMap((k) => [k, ...below(k.id)]);

  return {
    runningUnder(id) {
      const own = byId.get(id)?.activity.backgroundAgents ?? 0;
      return own + below(id).filter(isRunning).length;
    },
    rootOf(id) {
      let thread = byId.get(id);
      while (thread?.parentThreadId != null && byId.has(thread.parentThreadId)) thread = byId.get(thread.parentThreadId);
      return thread?.id ?? null;
    },
  };
}

function childrenByParent(threads: readonly PluginSidebarThread[]): Map<string, PluginSidebarThread[]> {
  const children = new Map<string, PluginSidebarThread[]>();
  for (const t of threads) {
    if (t.parentThreadId === null) continue;
    const siblings = children.get(t.parentThreadId) ?? [];
    siblings.push(t);
    children.set(t.parentThreadId, siblings);
  }
  return children;
}

// why: a subthread never sleeps, so its base state says whether it runs.
function isRunning(thread: PluginSidebarThread): boolean {
  const state = baseState(thread);
  return state !== null && UNDER_WAY.has(state);
}

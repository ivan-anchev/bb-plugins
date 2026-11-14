// Who hangs under whom, from the live array the sidebar hook already holds: no request.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { baseState, UNDER_WAY, withWait, type ZState } from "./state.ts";

export type ThreadIndex = {
  /** The pill: the thread's own background agents plus every running thread below it. */
  runningUnder(id: string): number;
  /** The parentless ancestor of `id`, or `id` itself; null for an id the index doesn't hold. */
  rootOf(id: string): string | null;
  /** The threads directly under `id`, in the live array's order. */
  childrenOf(id: string): readonly PluginSidebarThread[];
  /** Every thread below `id`, each child before its own children. */
  below(id: string): readonly PluginSidebarThread[];
  /**
   * Its state before Sleep: bb's, or Waiting while its turn is over but something will wake it: a
   * subthread that reports back to it still under way, or a hand-off held (src/handoff/handoff.ts).
   */
  liveState(thread: PluginSidebarThread): ZState | null;
};

/**
 * Built once per hook update, with the threads whose hand-off is `held`. Hidden and archived threads
 * are left out, as bb's own list does.
 */
export function indexThreads(threads: readonly PluginSidebarThread[], held: ReadonlySet<string>): ThreadIndex {
  const live = threads.filter((t) => !t.isHidden && !t.isArchived);
  const byId = new Map(live.map((t) => [t.id, t]));
  const children = childrenByParent(live);

  // Every visible, active thread below `id`, children first.
  const below = (id: string): PluginSidebarThread[] => (children.get(id) ?? []).flatMap((k) => [k, ...below(k.id)]);

  // why: bb wakes the parent when an "auto" child ends, so the parent's settled turn is not its last.
  const awaitsSubthread = (id: string): boolean =>
    (children.get(id) ?? []).some((k) => k.parentNotifications === "auto" && isUnderWay(liveState(k)));
  const liveState = (thread: PluginSidebarThread): ZState | null =>
    withWait(baseState(thread), held.has(thread.id) || awaitsSubthread(thread.id));

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
    childrenOf: (id) => children.get(id) ?? [],
    below,
    liveState,
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
  return isUnderWay(baseState(thread));
}

function isUnderWay(state: ZState | null): boolean {
  return state !== null && UNDER_WAY.has(state);
}

// Since when each thread has been under way, as far as this list has seen. bb's `updatedAt` holds still
// through a turn's events but moves whenever the thread is read (checked live), so a thread you open
// while it works would restart its "Working · for". Pure: the last map and the live threads in.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { UNDER_WAY } from "../model/state.ts";
import type { ThreadIndex } from "../model/thread-index.ts";

/**
 * Every thread under way now (by the index's live state, so waiting on a subthread or a held hand-off
 * counts), keyed by id: when it was first seen under way, or its `updatedAt` (its turn's start, unless
 * it was read since) when first seen already so. A thread that stops leaves.
 */
export function underWaySince(last: ReadonlyMap<string, number>, threads: readonly PluginSidebarThread[], index: ThreadIndex): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  for (const thread of threads) {
    const state = index.liveState(thread);
    if (state !== null && UNDER_WAY.has(state)) next.set(thread.id, last.get(thread.id) ?? thread.updatedAt);
  }
  return next;
}

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { NEEDS_YOU } from "../model/state.ts";
import { indexThreads } from "../model/thread-index.ts";

/** How long after its wait ends a settled thread still reads Waiting; the wakes come within a second or two. */
export const HANDOFF_MS = 10_000;

/** Who was Waiting at the last update, and who is held until when. */
export type Handoffs = { waiting: ReadonlySet<string>; held: ReadonlyMap<string, number> };

export const NO_HANDOFFS: Handoffs = { waiting: new Set(), held: new Map() };

/**
 * The hand-offs at `now`: a thread that was Waiting and no longer is, is held for HANDOFF_MS. A turn
 * inside the window keeps the hold (the state shows Working; settling again shows Waiting); the hold
 * ends at its time, when the thread waits again, or as soon as it asks for you or fails.
 */
export function nextHandoffs(last: Handoffs, threads: readonly PluginSidebarThread[], now: number): Handoffs {
  const index = indexThreads(threads, new Set());
  const waiting = new Set<string>();
  const held = new Map<string, number>();
  for (const thread of threads) {
    const state = index.liveState(thread);
    if (state === "waiting") waiting.add(thread.id);
    else if (state === null || !NEEDS_YOU.has(state)) {
      const until = last.waiting.has(thread.id) ? now + HANDOFF_MS : last.held.get(thread.id);
      if (until !== undefined && until > now) held.set(thread.id, until);
    }
  }
  return { waiting, held };
}

/** When the soonest hold ends, or null when nothing is held. */
export function nextRelease(handoffs: Handoffs): number | null {
  return handoffs.held.size === 0 ? null : Math.min(...handoffs.held.values());
}

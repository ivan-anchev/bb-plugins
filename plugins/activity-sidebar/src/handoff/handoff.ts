// The moment between a wait ending and the wake it brings. A thread waiting on background work or a
// subthread (bb wakes the parent when it ends) settles for a second or two before its next turn starts;
// held on Working through that gap, its row doesn't flash Completed on Activity and jump back. Pure: the
// last hand-offs, the live threads and the clock in.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { settled } from "../model/state.ts";
import { indexThreads } from "../model/thread-index.ts";

/** How long a thread whose wait ended stays Waiting for its next turn; the gap is a second or two. */
export const HANDOFF_MS = 10_000;

/** Who was Waiting at the last update, and who is held until when. */
export type Handoffs = { waiting: ReadonlySet<string>; held: ReadonlyMap<string, number> };

export const NO_HANDOFFS: Handoffs = { waiting: new Set(), held: new Map() };

/**
 * The hand-offs at `now`: a thread that was Waiting and has settled is held for HANDOFF_MS; a hold ends
 * at its time, or as soon as the thread does anything else (works, asks, fails, waits again).
 */
export function nextHandoffs(last: Handoffs, threads: readonly PluginSidebarThread[], now: number): Handoffs {
  // why: bb's states, unheld, say who waits now; a hold must never feed its own renewal.
  const index = indexThreads(threads, new Set());
  const waiting = new Set<string>();
  const held = new Map<string, number>();
  for (const thread of threads) {
    const state = index.liveState(thread);
    if (state === "waiting") waiting.add(thread.id);
    else if (settled(state)) {
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

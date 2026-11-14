// The list's hand-offs (src/handoff/handoff.ts), carried from one live update to the next, with a
// timer that releases each hold at its time.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import { nextHandoffs, nextRelease, NO_HANDOFFS } from "./handoff.ts";

/** The threads held on Working for the wake their ended wait brings. */
export function useHandoffs(threads: readonly PluginSidebarThread[]): ReadonlySet<string> {
  const [seen, setSeen] = useState(() => ({ threads, handoffs: nextHandoffs(NO_HANDOFFS, threads, Date.now()) }));
  let current = seen;
  // why: React's "adjust state when a prop changes", so the hold is in place on the very render the
  // wait ends; an effect would paint one frame of Completed first and start the row's move.
  if (seen.threads !== threads) {
    current = { threads, handoffs: nextHandoffs(seen.handoffs, threads, Date.now()) };
    setSeen(current);
  }
  const { handoffs } = current;

  useEffect(() => {
    const release = nextRelease(handoffs);
    if (release === null) return;
    const timer = setTimeout(
      () => setSeen((s) => ({ threads: s.threads, handoffs: nextHandoffs(s.handoffs, s.threads, Date.now()) })),
      release - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [handoffs]);

  return useMemo(() => new Set(handoffs.held.keys()), [handoffs]);
}

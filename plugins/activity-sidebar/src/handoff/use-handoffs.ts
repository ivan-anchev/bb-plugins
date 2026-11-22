import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import { nextHandoffs, nextRelease, NO_HANDOFFS } from "./handoff.ts";

/** The threads held on Working for the wake their ended wait brings. */
export function useHandoffs(threads: readonly PluginSidebarThread[]): ReadonlySet<string> {
  const [seen, setSeen] = useState(() => ({ threads, handoffs: nextHandoffs(NO_HANDOFFS, threads, Date.now()) }));
  let current = seen;
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

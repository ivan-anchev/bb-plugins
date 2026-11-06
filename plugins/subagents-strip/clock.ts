// One shared 1 s tick for every live timer in the window, and the duration format.
import { useCallback, useSyncExternalStore } from "react";

/** The current time, re-rendering once a second while `live`; frozen otherwise. */
export function useNow(live: boolean): number {
  const subscribe = useCallback((onTick: () => void) => (live ? onEveryTick(onTick) : () => {}), [live]);
  return useSyncExternalStore(subscribe, () => tickNow);
}

/** 45s / 4m 05s / 1h 02m. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

// ---------------------------------------------------------------- layer 2

let tickNow = Date.now();
const tickers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function onEveryTick(onTick: () => void): () => void {
  tickers.add(onTick);
  if (!timer) {
    // why: a timer going live must not show a stale instant; React rereads the
    // snapshot right after subscribing, so this lands before the first tick.
    tickNow = Date.now();
    timer = setInterval(() => {
      tickNow = Date.now();
      tickers.forEach((tick) => tick());
    }, 1000);
  }
  return () => {
    tickers.delete(onTick);
    if (tickers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

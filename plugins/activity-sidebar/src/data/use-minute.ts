// One minute clock for the whole list: every corner's "5m" moves on the same tick.
import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(tick, MINUTE);
  }
  return () => {
    listeners.delete(listener);
    // why: no reader, no timer; the next one restarts it with a fresh now.
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
}

const snapshot = () => now;

/** Epoch ms, refreshed once a minute while anything reads it. */
export function useMinute(): number {
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * Moves the shared clock to the present and returns it. A write stamped with it (Wake, a sleep ended
 * early) reads as already past on the next render, not a minute later.
 */
export function syncMinute(): number {
  tick();
  return now;
}

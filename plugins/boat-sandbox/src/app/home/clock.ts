// Timers for the card, both still while bb's tab is hidden.
import { useEffect, useState } from "react";

/** `Date.now()`, read again every `ms` while the page shows. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** Calls `run` every `ms` while the page shows. */
export function useEvery(ms: number, run: () => void): void {
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) run();
    }, ms);
    return () => clearInterval(timer);
  }, [ms, run]);
}

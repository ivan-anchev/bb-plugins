import { useEffect, useState } from "react";

/** "4:12": minutes and seconds from `since` to `now`, both epoch ms. */
export function elapsedLabel(since: number, now: number): string {
  // A clock behind the server's would show negative time; read that as just started.
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// The time since `since`, re-rendered every second. An effect because the clock is outside React.
export function useElapsed(since: number): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return elapsedLabel(since, now);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** How long ago, in a corner's room: "now", "5m", "3h", "2d", "1w" (Zeron: ds/locale.luau ago_short). */
export function ago(at: number, now: number): string {
  const t = Math.max(0, now - at);
  if (t < MINUTE) return "now";
  if (t < HOUR) return `${Math.floor(t / MINUTE)}m`;
  if (t < DAY) return `${Math.floor(t / HOUR)}h`;
  if (t < WEEK) return `${Math.floor(t / DAY)}d`;
  return `${Math.floor(t / WEEK)}w`;
}

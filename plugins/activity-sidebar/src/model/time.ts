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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A local time on a 12-hour clock: "3:45 PM" (Zeron: ds/locale.luau clock). */
export function clock(at: number): string {
  const d = new Date(at);
  const h = d.getHours() % 12;
  return `${h === 0 ? 12 : h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** A local day's short name: "Mon" (Zeron: ds/locale.luau weekday, time.weekday_short). */
export function weekday(at: number): string {
  return WEEKDAYS[new Date(at).getDay()];
}

/** A local day of its month: "Nov 14" (Zeron: ds/locale.luau month_day). */
export function monthDay(at: number): string {
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

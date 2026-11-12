const DAY = 24 * 3600;

const UNITS: [unit: Intl.RelativeTimeFormatUnit, seconds: number][] = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["week", 7 * DAY],
  ["day", DAY],
  ["hour", 3600],
  ["minute", 60],
];

const format = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

/** "5m ago", "yesterday", "3mo ago": how long before `now` the ISO time `at` was. */
export function timeAgo(at: string, now: number): string {
  const seconds = Math.round((Date.parse(at) - now) / 1000);
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ["second", 1];
  return unit === "second" ? "just now" : format.format(Math.round(seconds / size), unit);
}

/** "8d ago" from a day to a month before `now`, else as timeAgo: for a list of lines, where "last wk." on each would tell them apart less. */
export function daysAgo(at: string, now: number): string {
  const seconds = (now - Date.parse(at)) / 1000;
  return seconds >= DAY && seconds < 30 * DAY ? `${Math.round(seconds / DAY)}d ago` : timeAgo(at, now);
}

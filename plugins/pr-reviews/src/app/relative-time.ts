const UNITS: [unit: Intl.RelativeTimeFormatUnit, seconds: number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
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

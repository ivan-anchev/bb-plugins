// Money and days as the card writes them.

/** `$0.36`; `digits` 3 for a running boat's cost, which moves a tenth of a cent at a time. */
export const usd = (dollars: number, digits = 2): string => `$${dollars.toFixed(digits)}`;

/** A day's spend: under a cent reads `<$0.01`, not `$0.00`. */
export const daySpend = (dollars: number): string => (dollars > 0 && dollars < 0.01 ? "<$0.01" : usd(dollars));

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** `Nov 10` for a UTC day (`2026-11-10`) or an instant's UTC day. */
export const dayLabel = (day: string | number): string => dayFormat.format(typeof day === "string" ? Date.parse(day) : day);

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** `14:02` (or `2:02 PM`) in the browser's time zone. */
export const timeLabel = (at: number): string => timeFormat.format(at);

// Words and dates as the card shows them.
export function plural(n: number, one: string): string {
  return `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
}

export const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
export const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short" });

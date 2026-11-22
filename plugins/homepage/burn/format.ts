import type { BurnRange } from "../contract.ts";

/** "$0", "$4.27" under ten dollars, otherwise whole dollars: "$1,800". */
export function formatMoney(dollars: number): string {
  if (dollars === 0) return "$0";
  if (dollars < 0.005) return "<$0.01";
  if (dollars < 9.995) return `$${dollars.toFixed(2)}`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/**
 * "5.13B" (one decimal from 10B), "235M" ("1.5M" and "23.4M" under 100M), "12K" ("1.5K" under 10K).
 * why the odd thresholds: each is where rounding would carry into the next unit or precision, so
 * 999,999 reads "1.0M", never "1000K".
 */
export function formatTokens(tokens: number): string {
  if (tokens < 999.5) return String(Math.round(tokens));
  if (tokens < 999_500) return tokens < 9_950 ? `${(tokens / 1e3).toFixed(1)}K` : `${Math.round(tokens / 1e3)}K`;
  if (tokens < 999_500_000) return tokens < 99_950_000 ? `${(tokens / 1e6).toFixed(1)}M` : `${Math.round(tokens / 1e6)}M`;
  return `${(tokens / 1e9).toFixed(tokens < 9_995_000_000 ? 2 : 1)}B`;
}

export type Direction = "up" | "down" | "same" | "none";

export interface Change {
  direction: Direction;
  /** What the card shows: "▲ 125%", "▼ 12%", "same", or "—" when there is nothing to compare with. */
  short: string;
  /** For the tooltip: "▲ 125% vs previous 7 days", "No spend in the previous 30 days". */
  full: string;
  /** For screen readers, with words for the arrows: "up 125% vs previous 7 days". */
  spoken: string;
}

const PREVIOUS: Record<BurnRange, string> = { "7d": "previous 7 days", "30d": "previous 30 days" };
const NONE: Record<"spend" | "tokens", string> = { spend: "No spend", tokens: "No use" };

/**
 * How `now` compares with `before`, Burn's Spend page's change (extensions/bb/spend/usage.tsx) without
 * the "vs previous 7 days" on the card: the Week/Month switch already names the period.
 */
export function describeChange(now: number, before: number, range: BurnRange, metric: "spend" | "tokens"): Change {
  const previous = PREVIOUS[range];
  if (before === 0) {
    const full = `${NONE[metric]} in the ${previous}`;
    return { direction: "none", short: "—", full, spoken: full };
  }
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) {
    const full = `Same as ${previous}`;
    return { direction: "same", short: "same", full, spoken: full };
  }
  const up = pct > 0;
  const size = `${Math.abs(pct).toLocaleString("en-US")}%`;
  return {
    direction: up ? "up" : "down",
    short: `${up ? "▲" : "▼"} ${size}`,
    full: `${up ? "▲" : "▼"} ${size} vs ${previous}`,
    spoken: `${up ? "up" : "down"} ${size} vs ${previous}`,
  };
}

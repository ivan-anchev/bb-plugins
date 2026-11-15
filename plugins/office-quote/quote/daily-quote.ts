// Today's quote: one per local day, saved so every visit that day shows the same one.
// The first read of a new day fetches the next quote; checks that overlap share one fetch,
// and a failed fetch keeps the last quote and tries again on the next read.
import type { Quote } from "../contract.ts";

const KEY = "daily-quote";

type SavedQuote = { day: string; quote: Quote };

export interface DailyQuoteDeps {
  kv: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  fetchQuote(): Promise<Quote>;
  /** Called after the quote changes, so an open homepage shows the new one. */
  onChanged(): void;
  warn(message: string): void;
  now(): number;
}

export function createDailyQuote(deps: DailyQuoteDeps) {
  let running: Promise<void> | null = null;

  /** Fetches a new quote if the saved one is from another day. Safe to call any number of times. */
  function ensureToday(): Promise<void> {
    running ??= replaceIfStale(deps).finally(() => (running = null));
    return running;
  }

  async function read(): Promise<Quote | null> {
    await ensureToday();
    return (await deps.kv.get<SavedQuote>(KEY))?.quote ?? null;
  }

  return { read, ensureToday };
}

async function replaceIfStale(deps: DailyQuoteDeps): Promise<void> {
  const today = localDay(deps.now());
  const saved = await deps.kv.get<SavedQuote>(KEY);
  if (saved?.day === today) return;
  try {
    await deps.kv.set(KEY, { day: today, quote: await deps.fetchQuote() } satisfies SavedQuote);
    deps.onChanged();
  } catch (error) {
    deps.warn(`Couldn't fetch today's quote: ${String(error)}`);
  }
}

/** YYYY-MM-DD of the server's local day. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { QUOTE_TAG, quoteContract } from "./contract.ts";
import { createDailyQuote } from "./quote/daily-quote.ts";
import { fetchRandomQuote } from "./quote/office-api.ts";

export default function plugin(bb: BbPluginApi): void {
  const dailyQuote = createDailyQuote({
    kv: bb.storage.kv,
    fetchQuote: fetchRandomQuote,
    onChanged: () => bb.rpc.experimental_invalidate([QUOTE_TAG]),
    warn: (message) => bb.log.warn(message),
    now: Date.now,
  });

  bb.rpc.register(quoteContract, { today: () => dailyQuote.read() });

  bb.background.schedule("new-day", "0 0 * * *", () => dailyQuote.ensureToday());
}

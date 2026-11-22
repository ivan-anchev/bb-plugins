import { z } from "zod";
import type { Quote } from "../contract.ts";

const RANDOM_QUOTE_URL = "https://officeapi.akashrajpurohit.com/quote/random";

const wireQuoteSchema = z.object({ character: z.string(), quote: z.string(), character_avatar_url: z.string() });

export async function fetchRandomQuote(): Promise<Quote> {
  const response = await fetch(RANDOM_QUOTE_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`The Office API answered ${response.status}`);
  const wire = wireQuoteSchema.parse(await response.json());
  return { character: wire.character, quote: wire.quote, avatar: wire.character_avatar_url };
}

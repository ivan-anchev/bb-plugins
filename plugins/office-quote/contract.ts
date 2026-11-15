// Shared by server.ts and app.tsx: today's quote.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const QUOTE_TAG = "quote";

const quoteSchema = z.object({
  character: z.string(),
  quote: z.string(),
  /** The character's picture; hosted by Reddit, Pinterest or Medium, so it can fail to load. */
  avatar: z.string(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const quoteContract = defineRpcContract({
  /** Today's quote; null until the first one has been fetched. A new day invalidates the tag. */
  today: { input: z.object({}), output: quoteSchema.nullable(), tags: () => [QUOTE_TAG] },
});

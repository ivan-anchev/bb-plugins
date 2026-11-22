import { Markdown } from "@get-bb/plugin-sdk/app";
import type { Quote } from "../contract.ts";

/** Clamped to a few lines, since the draft is the point. */
export function QuoteBlock({ quote }: { quote: Quote }) {
  return (
    <figure className="nt-quote">
      <blockquote className="nt-quote-text">
        {quote.text}
      </blockquote>
      <Markdown className="nt-quote-source" content={`@thread:${quote.threadId}#msg=${quote.messageSeq}`} />
    </figure>
  );
}

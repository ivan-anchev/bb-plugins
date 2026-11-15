// The passage a note quotes, behind its left bar, and a chip that opens the message it came from.
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { Quote } from "../contract.ts";

/**
 * The form clamps the passage to a few lines, since the draft is the point there; an opened note
 * shows all of it (`whole`).
 */
export function QuoteBlock({ quote, whole = false }: { quote: Quote; whole?: boolean }) {
  return (
    <figure className="nt-quote">
      <blockquote className="nt-quote-text" data-whole={whole || undefined}>
        {quote.text}
      </blockquote>
      {/* why bb's Markdown: it draws a message token as the chat's own thread mention, which opens
          that thread at that message, as a mention in a reply does. */}
      <Markdown className="nt-quote-source" content={`@thread:${quote.threadId}#msg=${quote.messageSeq}`} />
    </figure>
  );
}

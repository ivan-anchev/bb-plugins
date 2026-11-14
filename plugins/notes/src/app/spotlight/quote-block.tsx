// The passage a note quotes, and a chip that opens the message it came from.
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { Quote } from "../../contract.ts";

/**
 * Composing clamps the passage to a few lines, since the draft is the point there. Reading a saved
 * note shows all of it (`whole`), scrolling when long, so Tab reaches it to scroll by keyboard.
 */
export function QuoteBlock({ quote, whole = false }: { quote: Quote; whole?: boolean }) {
  return (
    <figure className="nt-quote">
      <blockquote className="nt-quote-text" data-whole={whole || undefined} tabIndex={whole ? 0 : undefined}>
        {quote.text}
      </blockquote>
      {/* why bb's Markdown: it draws a message token as the chat's own thread mention, which opens
          that thread at that message, as a mention in a reply does. */}
      <Markdown className="nt-quote-source" content={`@thread:${quote.threadId}#msg=${quote.messageSeq}`} />
    </figure>
  );
}

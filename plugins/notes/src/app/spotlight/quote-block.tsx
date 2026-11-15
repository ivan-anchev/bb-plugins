// The passage a note quotes, and a chip that opens the message it came from.
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { Quote } from "../../contract.ts";

export function QuoteBlock({ quote }: { quote: Quote }) {
  return (
    <figure className="nt-quote">
      <blockquote className="nt-quote-text">{quote.text}</blockquote>
      {/* why bb's Markdown: it draws a message token as the chat's own thread mention, which opens
          that thread at that message, as a mention in a reply does. */}
      <Markdown className="nt-quote-source" content={`@thread:${quote.threadId}#msg=${quote.messageSeq}`} />
    </figure>
  );
}

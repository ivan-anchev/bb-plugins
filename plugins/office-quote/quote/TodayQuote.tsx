// Today's quote, drawn above the composer: the line, then the character's face and name.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { AboveComposer } from "../above-composer.tsx";
import { quoteContract, type Quote } from "../contract.ts";

export function TodayQuote() {
  const { data: quote } = experimental_useRpcQuery({ contract: quoteContract, method: "today", input: {} });
  if (!quote) return null;
  return (
    <AboveComposer>
      <figure className="oq-quote" key={quote.quote}>
        <blockquote className="oq-quote-text" data-long={isLong(quote) ? "" : undefined}>{quote.quote}</blockquote>
        <figcaption className="oq-quote-cite">
          <Avatar quote={quote} />
          <span>{quote.character}</span>
        </figcaption>
      </figure>
    </AboveComposer>
  );
}

/** The character's face; their initials when the image host fails. */
function Avatar({ quote }: { quote: Quote }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="oq-avatar oq-avatar-initials" aria-hidden>{initials(quote.character)}</span>;
  return <img className="oq-avatar" src={quote.avatar} alt="" width={20} height={20} onError={() => setFailed(true)} />;
}

/** Long quotes step down a size so they hold to three or four lines. */
function isLong(quote: Quote): boolean {
  return quote.quote.length > 90;
}

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2);
}

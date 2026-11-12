// The agent's and the author's text, rendered as markdown by bb's chat renderer: one renderer for
// every piece of guide prose, so `code`, emphasis and links look the same everywhere.
import { Markdown } from "@get-bb/plugin-sdk/app";

// why: bb's Markdown is styled for a chat message on the page background. Guide text sits on other
// surfaces too (a finding block, "For you to decide"), so it adapts to where it sits:
// - size, leading and colour come from the parent: bb sets chat type on the root and the foreground
//   colour on every paragraph, list, list item and heading. A `className` with its own size or
//   colour still wins.
// - inline code gets a tint of the foreground instead of bb's `bg-muted/70`, which vanishes on a
//   `bg-muted` block. At 8% it matches bb's chip on the page background.
// - the space between blocks is `pr-reviews-prose` in app.css, not bb's chat margins: GitHub's
//   markdown rhythm, scaled to the type size the parent sets.
const FIT_TO_PARENT = [
  "pr-reviews-prose",
  "text-[length:inherit] leading-[inherit] text-inherit [&_:is(p,ul,ol,li,h1,h2,h3,h4)]:text-inherit",
  "[&_:not(pre)>code]:bg-foreground/8",
].join(" ");

export function Prose({ text, className = "" }: { text: string; className?: string }) {
  return <Markdown content={text} className={`${FIT_TO_PARENT} ${className}`} />;
}
